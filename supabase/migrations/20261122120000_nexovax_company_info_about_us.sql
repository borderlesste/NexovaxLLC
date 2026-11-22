-- NEXOVAX: company data (footer, /sobre-nosotros) and the "Sobre nosotros" page.
--
--  * company.info: legal name, jurisdiction, address, registration number, phone, support hours and
--    footer text, edited in Admin → Configuración → Ayuda y redes → Empresa y pie de página. Starts
--    empty: the API uses its defaults (nothing shown) until an admin saves it.
--  * ABOUT_US: informational public policy (audience PUBLIC, acceptance NONE) shown at /sobre-nosotros,
--    edited and versioned in Admin → Ajustes → Políticas legales, in es/en/fr/ht. The page adds the
--    company data from company.info below the text, so the text itself names no legal entity.

insert into public.system_setting_definitions (key, description, value_type, allowed_scopes, security_class, is_runtime_mutable, is_active)
values ('company.info', 'Datos de la empresa que opera el marketplace (pie de página y Sobre nosotros): razón social, jurisdicción, domicilio, teléfono, horario y texto del pie.', 'OBJECT', '["GLOBAL"]', 'PUBLIC', true, true)
on conflict (key) do update set description = excluded.description, value_type = excluded.value_type, is_active = true;

insert into public.policy_types (code, name, description, acceptance_mode, audience, is_system) values
  ('ABOUT_US', 'Sobre nosotros', 'Quiénes somos, cómo funciona el marketplace y cómo contactarnos.', 'NONE', 'PUBLIC', true)
on conflict (code) do nothing;

do $$
declare
  v_policy uuid; v_version uuid;
  loc jsonb := jsonb_build_object(
    'es', jsonb_build_array('Sobre nosotros', $t$NEXOVAX es un marketplace internacional: reúne en un solo lugar a tiendas de distintos países y a compradores de todo el mundo, con un único carrito, pagos protegidos y envíos con seguimiento.

Cómo funciona: cada tienda publica sus productos, fija sus precios y prepara y envía sus propios pedidos. NEXOVAX opera la plataforma: procesa los pagos, calcula el envío y los impuestos antes de que pagues, y libera el dinero a la tienda solo después de la entrega.

Tiendas: cada tienda se registra con su país, su identificación fiscal y la dirección desde donde despacha, y verificamos su cuenta de cobro antes de pagarle. Las reseñas de los compradores son públicas.

Compradores: todas las tiendas siguen la misma política de devoluciones y la misma política de envíos. Si un pedido no llega o no coincide con lo descrito, nuestro equipo interviene.

Idiomas: el sitio y la atención están disponibles en español, inglés, francés y criollo haitiano.

Contacto: escríbenos desde Ayuda → Contactar a soporte (no necesitas una cuenta) o al correo de soporte que aparece abajo. Los datos legales de la empresa se muestran al final de esta página.$t$),
    'en', jsonb_build_array('About us', $t$NEXOVAX is an international marketplace: it brings together stores from different countries and buyers from around the world in one place, with a single cart, protected payments and tracked shipping.

How it works: each store lists its products, sets its prices and prepares and ships its own orders. NEXOVAX runs the platform: it processes payments, calculates shipping and taxes before you pay, and releases the money to the store only after delivery.

Stores: every store signs up with its country, its tax ID and the address it ships from, and we verify its payout account before paying it. Buyer reviews are public.

Buyers: every store follows the same return policy and the same shipping policy. If an order doesn’t arrive or isn’t as described, our team steps in.

Languages: the site and our support are available in Spanish, English, French and Haitian Creole.

Contact: write to us from Help → Contact support (no account needed) or at the support e-mail shown below. The company’s legal details appear at the end of this page.$t$),
    'fr', jsonb_build_array('À propos', $t$NEXOVAX est une marketplace internationale : elle réunit en un seul endroit des boutiques de différents pays et des acheteurs du monde entier, avec un panier unique, des paiements protégés et des livraisons suivies.

Fonctionnement : chaque boutique publie ses produits, fixe ses prix, puis prépare et expédie ses propres commandes. NEXOVAX exploite la plateforme : elle traite les paiements, calcule la livraison et les taxes avant que vous payiez et ne verse l’argent à la boutique qu’après la livraison.

Boutiques : chaque boutique s’inscrit avec son pays, son identifiant fiscal et l’adresse d’expédition, et nous vérifions son compte de versement avant de la payer. Les avis des acheteurs sont publics.

Acheteurs : toutes les boutiques appliquent la même politique de retour et la même politique de livraison. Si une commande n’arrive pas ou ne correspond pas à la description, notre équipe intervient.

Langues : le site et le support sont disponibles en espagnol, anglais, français et créole haïtien.

Contact : écrivez-nous depuis Aide → Contacter le support (sans compte) ou à l’adresse e-mail du support indiquée ci-dessous. Les informations légales de l’entreprise figurent en bas de cette page.$t$),
    'ht', jsonb_build_array('Konsènan nou', $t$NEXOVAX se yon maketplas entènasyonal: li mete ansanm, nan yon sèl kote, boutik ki soti nan plizyè peyi ak achtè toupatou nan mond lan, ak yon sèl panye, peman pwoteje ak livrezon ou ka swiv.

Kijan sa mache: chak boutik pibliye pwodwi l, fikse pri l epi prepare ak voye pwòp kòmand pa l. NEXOVAX jere platfòm nan: li trete peman yo, li kalkile livrezon ak taks yo anvan ou peye, epi li bay boutik la lajan an sèlman apre livrezon an.

Boutik: chak boutik enskri ak peyi l, nimewo fiskal li ak adrès kote l voye pwodwi yo, epi nou verifye kont peman li anvan nou peye l. Avi achtè yo piblik.

Achtè: tout boutik swiv menm règ pou retou ak menm règ pou livrezon. Si yon kòmand pa rive oswa li pa sanble ak deskripsyon an, ekip nou an entèvni.

Lang: sit la ak sèvis sipò a disponib an espanyòl, angle, franse ak kreyòl ayisyen.

Kontak: ekri nou nan Èd → Kontakte sipò (ou pa bezwen kont) oswa nan imèl sipò ki parèt anba a. Enfòmasyon legal konpayi an parèt anba paj sa a.$t$)
  );
begin
  if exists (select 1 from public.policies where code = 'ABOUT_US') then return; end if;
  insert into public.policies (code, policy_type_code, slug, default_locale) values ('ABOUT_US', 'ABOUT_US', 'sobre-nosotros', 'es') returning id into v_policy;
  insert into public.policy_versions (policy_id, version_number) values (v_policy, 1) returning id into v_version;
  insert into public.policy_version_localizations (policy_version_id, locale, title, content_format, content)
  select v_version, l.key, l.value->>0, 'PLAIN_TEXT', jsonb_build_object('text', l.value->>1) from jsonb_each(loc) l;
  -- Published (and audited) on behalf of the marketplace owner: the first active super administrator.
  perform public.publish_policy_version(v_version, (
    select ur.user_id from public.user_roles ur join public.roles r on r.id = ur.role_id join public.users u on u.id = ur.user_id
     where r.code = 'SUPER_ADMIN' and ur.revoked_at is null and u.status = 'ACTIVE' order by u.created_at limit 1), now());
end $$;
