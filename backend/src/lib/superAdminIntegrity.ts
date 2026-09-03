import prisma from './prisma';
import { SUPER_ADMIN_CONFIG, isKhizarHayatUser, isKhizarHayatEmployee, isSuperAdminRole } from '../config/superAdmin';
import { writeAuditLog } from './business';

/**
 * Verifies system-wide Super Admin integrity at startup and during authorization checks.
 * Enforces SUPER_ADMIN_COUNT <= 1 and ensures the only account with Super Admin
 * privileges is Khizar Hayat.
 */
export async function verifySuperAdminIntegrity(): Promise<{
  isValid: boolean;
  superAdminUser: any;
  superAdminEmployee: any;
  conflictsResolved: number;
}> {
  console.log('[SECURITY] Verifying Super Admin system integrity...');

  let conflictsResolved = 0;

  // 1. Check for any non-Khizar Hayat users claiming SUPER_ADMIN
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });

  for (const u of users) {
    if (isSuperAdminRole(u.role) && !isKhizarHayatUser(u.id, u.email)) {
      console.warn(`[SECURITY ALERT] Unauthorized SUPER_ADMIN detected on user ${u.id} (${u.name}, ${u.email}). Safely migrating to MANAGER...`);
      await prisma.user.update({
        where: { id: u.id },
        data: { role: 'MANAGER' },
      });
      await writeAuditLog({
        branchId: 'main',
        action: 'SUPER_ADMIN_CONFLICT_RESOLVED',
        entity: 'User',
        entityId: u.id,
        newData: { reason: 'Unauthorized SUPER_ADMIN role removed per security policy', previousRole: u.role, newRole: 'MANAGER' },
      });
      conflictsResolved++;
    }
  }

  // 2. Verify Khizar Hayat's authoritative User record exists and is active
  let khizarUser = await prisma.user.findFirst({
    where: {
      OR: [
        { id: SUPER_ADMIN_CONFIG.userId },
        { email: SUPER_ADMIN_CONFIG.email },
      ],
    },
  });

  if (khizarUser) {
    if (!khizarUser.isActive) {
      console.log(`[SECURITY] Re-activating protected Super Admin user account ${khizarUser.id}...`);
      khizarUser = await prisma.user.update({
        where: { id: khizarUser.id },
        data: { isActive: true, deletedAt: null },
      });
    }
  } else {
    console.warn('[SECURITY WARNING] Authoritative Khizar Hayat User record not found by primary ID or email.');
  }

  // 3. Verify Khizar Hayat's authoritative Employee record exists and is active
  let khizarEmployee = await prisma.employee.findFirst({
    where: {
      OR: [
        { id: SUPER_ADMIN_CONFIG.employeeId },
        { employeeId: SUPER_ADMIN_CONFIG.employeeNumber },
        { phone: SUPER_ADMIN_CONFIG.phone },
      ],
    },
  });

  if (khizarEmployee) {
    if (!khizarEmployee.isActive) {
      console.log(`[SECURITY] Re-activating protected Super Admin employee profile ${khizarEmployee.id}...`);
      khizarEmployee = await prisma.employee.update({
        where: { id: khizarEmployee.id },
        data: { isActive: true },
      });
    }
  } else {
    console.warn('[SECURITY WARNING] Authoritative Khizar Hayat Employee record not found by primary ID or employee number.');
  }

  console.log(`[SECURITY] Super Admin integrity check complete. Conflicts resolved: ${conflictsResolved}. Authoritative Super Admin: Khizar Hayat (User: ${khizarUser?.id ?? 'N/A'}, Employee: ${khizarEmployee?.id ?? 'N/A'}).`);

  return {
    isValid: true,
    superAdminUser: khizarUser,
    superAdminEmployee: khizarEmployee,
    conflictsResolved,
  };
}

/**
 * Asserts that an operation does not attempt to assign, escalate, or duplicate SUPER_ADMIN privileges.
 * Throws 403 error if an unauthorized role assignment is attempted.
 */
export function assertNotSuperAdminEscalation(
  targetEmployeeIdOrPhone: string | null | undefined,
  requestedRole: string | null | undefined,
  actingUserId?: string | null
): void {
  if (!requestedRole) return;

  if (isSuperAdminRole(requestedRole)) {
    const isTargetKhizar = isKhizarHayatEmployee(targetEmployeeIdOrPhone);
    if (!isTargetKhizar) {
      const err: any = new Error('Forbidden: Only Khizar Hayat is authorized to hold the Super Admin role. Privilege escalation is strictly prohibited.');
      err.statusCode = 403;
      throw err;
    }
  }
}
