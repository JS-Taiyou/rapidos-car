import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// cn: combina clases condicionales y resuelve conflictos de Tailwind.
// Estándar de shadcn/ui (no es dependencia runtime: dos funciones puras).
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
