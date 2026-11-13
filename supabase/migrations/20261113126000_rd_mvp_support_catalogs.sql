-- RD Marketplace MVP: support catalogs used by "Reportar un problema" and the
-- admin "Seguimiento de reportes" screen. SLA targets are versioned data.
INSERT INTO public.support_priorities (code, name, rank, description) VALUES
  ('LOW',      'Baja',    5,  'Sugerencias y consultas sin impacto.'),
  ('NORMAL',   'Normal',  10, 'Incidencias que no bloquean la operación.'),
  ('HIGH',     'Alta',    20, 'Bloquea una compra, un cobro o el acceso.'),
  ('CRITICAL', 'Crítica', 30, 'Afecta a muchos usuarios o involucra fraude.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.support_ticket_categories (code, name, description, sort_order) VALUES
  ('TECHNICAL',    'Fallos técnicos',           'Errores, bloqueos o funciones que no funcionan.', 1),
  ('PURCHASE',     'Problemas de compra',       'Dificultades para realizar o completar un pedido.', 2),
  ('PAYMENTS',     'Cobros',                    'Cargos incorrectos, duplicados o no reconocidos.', 3),
  ('CONTENT',      'Contenido inapropiado',     'Publicaciones que infringen las políticas.', 4),
  ('SELLER_ISSUE', 'Incidencias con vendedores','Comportamientos abusivos, fraudes o incumplimientos.', 5),
  ('ACCOUNT',      'Acceso a cuenta',           'Problemas para iniciar sesión o recuperar la cuenta.', 6),
  ('SHIPPING',     'Envíos',                    'Retrasos, daños o pedidos marcados incorrectamente.', 7),
  ('SUGGESTION',   'Sugerencias',               'Ideas para mejorar el marketplace.', 8)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.support_teams (code, name, description) VALUES
  ('SUPPORT',    'Equipo de soporte',    'Atención de primer nivel a compradores y vendedores.'),
  ('MODERATION', 'Equipo de moderación', 'Contenido, vendedores y fraude.'),
  ('FINANCE',    'Equipo de finanzas',   'Cobros, reembolsos y liquidaciones.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.support_sla_policies (policy_code, version, name, status, priority_code,
       first_response_target_seconds, resolution_target_seconds, effective_from, published_at)
SELECT v.code, 1, v.name, 'ACTIVE', v.priority, v.fr, v.res, now(), now()
FROM (VALUES
  ('SLA_DEFAULT',  'SLA general (24-48 h)', NULL::text, 86400::bigint, 172800::bigint),
  ('SLA_HIGH',     'SLA prioridad alta',    'HIGH',     14400,         86400),
  ('SLA_CRITICAL', 'SLA prioridad crítica', 'CRITICAL', 3600,          28800)
) AS v(code, name, priority, fr, res)
WHERE NOT EXISTS (SELECT 1 FROM public.support_sla_policies p WHERE p.policy_code = v.code);
