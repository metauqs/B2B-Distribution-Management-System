import prisma from '../lib/prisma';

/**
 * Calculates a unique Employee ID using the employee's mobile/WhatsApp number.
 * Algorithm:
 * 1. Takes the last 4 digits of WhatsApp number (if provided) or mobile phone.
 * 2. Checks if an employee already has this employeeId.
 * 3. If a conflict exists, increases length to 5 digits (taking 1 more preceding digit).
 * 4. Continues increasing length until a unique Employee ID is found.
 */
export async function generateUniqueEmployeeId(phone?: string | null, whatsapp?: string | null, excludeId?: string): Promise<string> {
  const rawNumber = (whatsapp && whatsapp.trim().length >= 4)
    ? whatsapp.trim().replace(/\D/g, '')
    : (phone ? phone.trim().replace(/\D/g, '') : '');

  // Fallback if number is empty or shorter than 4 digits
  if (!rawNumber || rawNumber.length < 4) {
    const fallbackBase = (rawNumber || '0000').padStart(4, '0');
    let counter = 0;
    let candidate = fallbackBase;
    while (true) {
      const existing = await prisma.employee.findFirst({
        where: {
          employeeId: candidate,
          ...(excludeId ? { id: { not: excludeId } } : {})
        }
      });
      if (!existing) return candidate;
      counter++;
      candidate = String(Number(fallbackBase) + counter).padStart(4, '0');
    }
  }

  let len = 4;
  while (len <= rawNumber.length) {
    const candidate = rawNumber.slice(-len);
    const existing = await prisma.employee.findFirst({
      where: {
        employeeId: candidate,
        ...(excludeId ? { id: { not: excludeId } } : {})
      }
    });

    if (!existing) {
      return candidate;
    }
    len++;
  }

  // Edge case: if full number matches an existing employee ID, append counter
  let counter = 1;
  while (true) {
    const candidate = `${rawNumber}${counter}`;
    const existing = await prisma.employee.findFirst({
      where: {
        employeeId: candidate,
        ...(excludeId ? { id: { not: excludeId } } : {})
      }
    });
    if (!existing) return candidate;
    counter++;
  }
}
