-- Seller tax ID on buyers' receipts (Admin → Configuración → General → Recibos): which seller entity types
-- may have their tax ID printed. Only businesses can be chosen (COMPANY, PARTNERSHIP, NONPROFIT); individuals,
-- sole proprietors and "other" never show it, since it can be a personal ID number (SSN, Cédula, CPF).
-- Until an admin saves, the API uses its default (all three business types, settings.service.ts); the row is
-- only needed to save the setting.
insert into public.system_setting_definitions (key, description, value_type, allowed_scopes, security_class, is_runtime_mutable, is_active)
values ('receipts.seller_tax_id', 'Recibos: tipos de entidad del vendedor cuya identificación fiscal se muestra al comprador (solo empresas).', 'OBJECT', '["GLOBAL"]', 'INTERNAL', true, true)
on conflict (key) do update set description = excluded.description, value_type = excluded.value_type, is_active = true;
