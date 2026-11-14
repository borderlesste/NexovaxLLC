import type { Role } from './auth';
import { t } from './i18n';

/**
 * What each staff role may do in the admin panel. Mirrors the API's @Roles guards
 * (backend/src/admin, returns, support): the API is the authority, this only decides
 * what the panel shows. ADMIN and SUPER_ADMIN may do everything.
 */
const RULES = {
  dashboard: ['SUPPORT', 'MODERATOR'],
  products: ['MODERATOR'],
  moderation: ['MODERATOR'],
  categories: ['MODERATOR'],
  'categories.edit': [],
  sellers: ['MODERATOR'],
  'sellers.create': [],
  'payoutAccounts.verify': [],
  orders: ['SUPPORT', 'MODERATOR'],
  'orders.tracking': ['SUPPORT'],
  'orders.refundWithoutReturn': [],
  tickets: ['SUPPORT', 'MODERATOR'],
  returns: ['SUPPORT'],
  'returns.refund': [],
  'returns.policy': [],
  finance: [],
  commissions: [],
  users: [],
  settings: [],
} satisfies Record<string, Role[]>;

export type Permission = keyof typeof RULES;

export const ROLE_NAMES: Record<Role, string> = {
  CUSTOMER: 'Cliente', SELLER: 'Vendedor', SUPPORT: 'Soporte', MODERATOR: 'Moderador', ADMIN: 'Administrador', SUPER_ADMIN: 'Super administrador',
};

export const isAdminRole = (roles: Role[]) => roles.includes('ADMIN') || roles.includes('SUPER_ADMIN');

export function can(roles: Role[] | undefined, perm: Permission) {
  if (!roles) return false;
  if (isAdminRole(roles)) return true;
  return (RULES[perm] as Role[]).some((r) => roles.includes(r));
}

/** Admin sections by path prefix; the first match decides. */
export const SECTIONS: { href: string; label: string; perm: Permission }[] = [
  { href: '/admin/dashboard', label: 'Dashboard', perm: 'dashboard' },
  { href: '/admin/productos', label: 'Productos', perm: 'products' },
  { href: '/admin/pedidos', label: 'Pedidos', perm: 'orders' },
  { href: '/admin/categorias', label: 'Categorías', perm: 'categories' },
  { href: '/admin/vendedores', label: 'Vendedores', perm: 'sellers' },
  { href: '/admin/moderacion', label: 'Moderación', perm: 'moderation' },
  { href: '/admin/reportes', label: 'Reportes y soporte', perm: 'tickets' },
  { href: '/admin/devoluciones', label: 'Devoluciones', perm: 'returns' },
  { href: '/admin/finanzas', label: 'Finanzas', perm: 'finance' },
  { href: '/admin/comisiones', label: 'Comisiones y payouts', perm: 'commissions' },
  { href: '/admin/usuarios', label: 'Usuarios', perm: 'users' },
  { href: '/admin/configuracion', label: 'Configuración', perm: 'settings' },
];

export const sectionFor = (path: string) => SECTIONS.find((s) => path === s.href || path.startsWith(s.href + '/'));

/** Plain-language summary of each staff role, shown on the "no permission" screen and in Settings → Roles. */
export const ROLE_SCOPE: Partial<Record<Role, { can: string[]; cannot: string[] }>> = {
  SUPPORT: {
    can: [
      'Ver el dashboard operativo (pedidos y colas de trabajo, sin cifras de ventas).',
      'Consultar pedidos y actualizar el seguimiento de los envíos.',
      'Atender reportes y tickets de soporte: asignar, responder, cambiar estado y notas internas.',
      'Gestionar devoluciones: aprobar, rechazar, generar etiqueta, recibir e inspeccionar.',
    ],
    cannot: [
      'Emitir reembolsos ni reembolsos sin devolución (solo Administrador).',
      'Moderar productos, gestionar vendedores o categorías.',
      'Ver finanzas, comisiones, payouts, usuarios o la configuración.',
    ],
  },
  MODERATOR: {
    can: [
      'Ver el dashboard operativo (pedidos y colas de trabajo, sin cifras de ventas).',
      'Revisar, aprobar, rechazar y suspender productos.',
      'Revisar vendedores: aprobar, suspender o reactivar tiendas.',
      'Consultar categorías y sus atributos (solo lectura).',
      'Consultar pedidos y atender reportes y tickets de soporte.',
    ],
    cannot: [
      'Crear vendedores ni verificar sus métodos de cobro (solo Administrador).',
      'Crear, editar o archivar categorías y atributos (solo Administrador).',
      'Gestionar devoluciones o actualizar seguimientos de envío (rol Soporte).',
      'Ver finanzas, comisiones, payouts, usuarios o la configuración.',
    ],
  },
};

export const roleList = (roles: Role[]) =>
  roles.filter((r) => r !== 'CUSTOMER' && r !== 'SELLER').map((r) => t(ROLE_NAMES[r])).join(', ');
