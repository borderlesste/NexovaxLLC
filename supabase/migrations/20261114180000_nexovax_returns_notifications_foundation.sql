-- Foundation for returns/refunds, the notification center, message attachments,
-- saved cards and scheduled payouts (all on top of the existing domain model).

-- ---------------------------------------------------------------- return policy
-- Every return request hangs from a versioned RETURN_POLICY (refund accounting needs it).
do $$
declare g uuid; v uuid;
begin
  if exists (select 1 from public.business_rule_groups where code = 'NX-GLOBAL-RETURNS') then return; end if;
  insert into public.business_rule_groups (rule_type_code, code, name, description, scope_type_code, priority, application_mode)
  values ('RETURN_POLICY', 'NX-GLOBAL-RETURNS', 'Política de devoluciones',
          '30 días desde la entrega; devolución parcial; revisión e inspección del vendedor; reembolso del producto e impuestos proporcionales.',
          'GLOBAL', 0, 'EXCLUSIVE')
  returning id into g;
  v := (public.create_business_rule_version(g, null, '{}'::jsonb, 'Política de devoluciones v1', 'APPLICATION', 'Política inicial', null)).id;
  insert into public.return_policy_rule_definitions (rule_version_id, return_window_seconds, return_window_anchor, allow_partial_return,
         allow_return_after_refund, require_reason, require_evidence, inspection_required, auto_approve, restocking_fee_type,
         original_shipping_refund_mode, tax_refund_mode, customer_fee_refund_mode, platform_commission_reversal_mode,
         referral_clawback_mode, processing_fee_recovery_mode, metadata)
  values (v, 30 * 86400, 'DELIVERED_AT', true, false, true, false, true, false, 'NONE',
          'NONE', 'PROPORTIONAL', 'PROPORTIONAL', 'PROPORTIONAL', 'PROPORTIONAL', 'NONE',
          jsonb_build_object('return_shipping', 'CUSTOMER_ARRANGED', 'max_evidence_files', 4));
  perform public.publish_business_rule_version(v, null, now(), 'APPLICATION', 'Política inicial', null);
end $$;

-- ---------------------------------------------------------------- return reasons (global)
insert into public.return_reason_definitions (seller_id, code, label, description, customer_selectable, requires_comment, requires_evidence, status, sort_order, metadata)
select null, x.code, x.label, x.descr, true, x.rc, x.re, 'ACTIVE', x.ord, jsonb_build_object('labelEn', x.en)
  from (values
    ('DAMAGED',          'Llegó dañado o defectuoso',        'El producto llegó roto, con fallas o no funciona.',          false, true,  10, 'Arrived damaged or defective'),
    ('WRONG_ITEM',       'Recibí un producto diferente',      'El artículo, la talla o el color no es el que pedí.',        false, true,  20, 'I received a different item'),
    ('NOT_AS_DESCRIBED', 'No coincide con la descripción',    'Las características no son las publicadas.',                 true,  false, 30, 'Not as described'),
    ('MISSING_PARTS',    'Faltan piezas o accesorios',        'El paquete llegó incompleto.',                               true,  false, 40, 'Missing parts or accessories'),
    ('SIZE_FIT',         'La talla o medida no me queda',     'El producto está en buen estado pero no es de mi medida.',   false, false, 50, 'Size or fit is wrong'),
    ('CHANGED_MIND',     'Ya no lo quiero',                   'Cambio de opinión; el producto está nuevo y sin usar.',      false, false, 60, 'Changed my mind'),
    ('OTHER',            'Otro motivo',                       'Explícalo en el comentario.',                                true,  false, 90, 'Other reason')
  ) as x(code, label, descr, rc, re, ord, en)
 where not exists (select 1 from public.return_reason_definitions r where r.seller_id is null and r.code = x.code);

-- ---------------------------------------------------------------- notification categories
insert into public.notification_categories (code, name, description, user_configurable, is_active)
values
  ('ORDERS',   'Pedidos y envíos',        'Confirmación de compra, despacho, entrega y nuevas ventas.', true,  true),
  ('MESSAGES', 'Mensajes',                'Mensajes nuevos de compradores y tiendas.',                  true,  true),
  ('RETURNS',  'Devoluciones y reembolsos','Solicitudes de devolución, revisión y reembolsos.',         true,  true),
  ('PAYMENTS', 'Pagos y retiros',          'Transferencias, retiros y cobros.',                         true,  true),
  ('SUPPORT',  'Soporte',                  'Respuestas y cambios de estado de tus reportes.',           true,  true),
  ('STORE',    'Mi tienda',                'Estado de la tienda y revisión de productos.',              true,  true),
  ('ACCOUNT',  'Cuenta y seguridad',       'Verificación de correo y recuperación de contraseña.',      false, true)
on conflict (code) do update set name = excluded.name, description = excluded.description, user_configurable = excluded.user_configurable, is_active = true;

-- ---------------------------------------------------------------- message / report attachments
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nx-message-attachments', 'nx-message-attachments', false, 10485760, array['image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

alter table public.assets drop constraint if exists nx_assets_attachment_bucket_user_key_scope;
alter table public.assets add constraint nx_assets_attachment_bucket_user_key_scope check (
  storage_bucket is distinct from 'nx-message-attachments'
  or (storage_provider = 'SUPABASE' and owner_seller_id is null and uploaded_by_user_id is not null and visibility = 'PRIVATE'
      and storage_key like (uploaded_by_user_id::text || '/attachments/%'))
);

-- Evidence photos of a return request (assets uploaded by the customer).
create table if not exists public.nx_return_request_evidence (
  return_request_id uuid not null references public.return_requests(id) on delete restrict,
  asset_id uuid not null references public.assets(id) on delete restrict,
  sort_order int not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  primary key (return_request_id, asset_id)
);
alter table public.nx_return_request_evidence enable row level security;

-- ---------------------------------------------------------------- grants for the API role
grant select, insert, update on public.notification_preferences to nexovax_api_runtime;
grant select, insert, update on public.customer_payment_provider_profiles, public.customer_payment_method_references to nexovax_api_runtime;
grant select, insert, update on public.return_inspections, public.return_inspection_items to nexovax_api_runtime;
grant update (status, removed_by_user_id, removal_reason, removed_at) on public.conversation_message_attachments to nexovax_api_runtime;
grant select, insert on public.nx_return_request_evidence to nexovax_api_runtime;

-- Finance admins process refunds end to end (approve → provider refund → ledger).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code in ('refunds.admin.process', 'refunds.ledger.plan', 'refunds.ledger.post')
 where r.code = 'ADMIN'
   and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_id = p.id and rp.revoked_at is null);
