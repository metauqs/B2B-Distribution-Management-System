import prisma from '../lib/prisma';

/**
 * Derives a 4-digit Employee ID from the last 4 digits of phone or WhatsApp number.
 * Checks if the generated 4-digit Employee ID already exists in the database.
 */
export async function generateEmployeeIdFromPhone(
  phone?: string | null,
  whatsapp?: string | null,
  excludeId?: string
): Promise<{ employeeId: string; isAvailable: boolean }> {
  const numStr = (phone && phone.trim().length >= 4)
    ? phone.trim().replace(/\D/g, '')
    : (whatsapp ? whatsapp.trim().replace(/\D/g, '') : '');

  let candidate = '0000';
  if (numStr.length >= 4) {
    candidate = numStr.slice(-4);
  } else if (numStr.length > 0) {
    candidate = numStr.padStart(4, '0');
  }

  const existing = await prisma.employee.findFirst({
    where: {
      employeeId: candidate,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });

  return {
    employeeId: candidate,
    isAvailable: !existing,
  };
}

export async function generateUniqueEmployeeId(
  phone?: string | null,
  whatsapp?: string | null,
  excludeId?: string
): Promise<string> {
  const result = await generateEmployeeIdFromPhone(phone, whatsapp, excludeId);
  return result.employeeId;
}
