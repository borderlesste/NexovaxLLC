-- Seller team: the store owner invites people and picks the areas each one can use.
-- Areas are permissions delegable to seller staff (granted through seller_member_permissions).
-- Money destinations, withdrawals and the team itself always stay with the owner.
insert into public.permissions (code, description, is_system, is_active, seller_staff_delegable) values
  ('seller.area.products',  'Seller team area: products, media and inventory.', true, true, true),
  ('seller.area.orders',    'Seller team area: orders, shipments, cancellations and returns.', true, true, true),
  ('seller.area.messages',  'Seller team area: conversations with buyers.', true, true, true),
  ('seller.area.marketing', 'Seller team area: coupons, offers and affiliates.', true, true, true),
  ('seller.area.finance',   'Seller team area: read balance, movements and withdrawals (no payouts).', true, true, true),
  ('seller.area.stats',     'Seller team area: sales statistics.', true, true, true),
  ('seller.area.settings',  'Seller team area: storefront profile and ship-from address.', true, true, true)
on conflict (code) do update set seller_staff_delegable = true, is_active = true;

-- The delegable-permission guard requires the SELLER role to hold the permission.
insert into public.role_permissions (role_id, permission_id, reason)
select r.id, p.id, 'Seller team areas'
  from public.roles r cross join public.permissions p
 where r.code = 'SELLER' and p.code like 'seller.area.%'
   and not exists (select 1 from public.role_permissions x where x.role_id = r.id and x.permission_id = p.id and x.revoked_at is null);

-- Areas chosen when inviting; copied to the member's grants on acceptance.
alter table public.seller_member_invitations
  add column if not exists areas text[] not null default '{}';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chk_seller_member_invitations_areas') then
    alter table public.seller_member_invitations add constraint chk_seller_member_invitations_areas
      check (areas <@ array['PRODUCTS','ORDERS','MESSAGES','MARKETING','FINANCE','STATS','SETTINGS']::text[]);
  end if;
end $$;

grant select on public.seller_member_invitations to nexovax_api_runtime;
grant insert, update on public.seller_member_permissions to nexovax_api_runtime;
