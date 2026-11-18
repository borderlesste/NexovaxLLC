-- NEXOVAX: the consent checkboxes and the "Producto destacado" switch become real.
--
--  * Legal policies are published in the policy engine (versioned, localized, checksummed):
--    TERMS_OF_SERVICE and PRIVACY_POLICY (accepted at sign-up), SELLER_TERMS (accepted when a
--    store is registered). Every acceptance is an append-only policy_acceptances row tied to the
--    exact version the person saw.
--  * nx_featured_products: products the team features on the home page.

insert into public.policy_types (code, name, description, acceptance_mode, audience, is_system) values
  ('TERMS_OF_SERVICE', 'Términos y condiciones', 'Condiciones de uso del marketplace.', 'EXPLICIT_CONSENT', 'BOTH', true),
  ('PRIVACY_POLICY', 'Política de privacidad', 'Cómo se usan los datos personales.', 'ACKNOWLEDGEMENT', 'BOTH', true),
  ('SELLER_TERMS', 'Términos para vendedores', 'Condiciones para vender, comisión y políticas de contenido.', 'EXPLICIT_CONSENT', 'SELLER', true)
on conflict (code) do nothing;

do $$
declare
  p record; v_policy uuid; v_version uuid;
begin
  for p in select * from (values
    ('TERMS_OF_SERVICE', 'terminos',
      jsonb_build_object(
        'es', jsonb_build_array('Términos y condiciones', 'Al usar NEXOVAX aceptas comprar y vender de buena fe, cumplir las leyes aplicables en tu país y en el país de destino de cada envío, y las políticas de contenido del marketplace. Los vendedores son responsables de la veracidad de sus publicaciones, precios, inventario, del despacho de sus pedidos y del cumplimiento aduanero de sus envíos internacionales.'),
        'en', jsonb_build_array('Terms and conditions', 'By using NEXOVAX you agree to buy and sell in good faith, comply with the laws of your country and of each shipment’s destination country, and follow the marketplace content policies. Sellers are responsible for the accuracy of their listings, prices and inventory, for shipping their orders and for customs compliance of their international shipments.'),
        'fr', jsonb_build_array('Conditions générales', 'En utilisant NEXOVAX, vous acceptez d’acheter et de vendre de bonne foi, de respecter les lois de votre pays et du pays de destination de chaque envoi, et de suivre les politiques de contenu de la marketplace. Les vendeurs sont responsables de l’exactitude de leurs annonces, prix et stocks, de l’expédition de leurs commandes et de la conformité douanière de leurs envois internationaux.'),
        'ht', jsonb_build_array('Tèm ak kondisyon', 'Lè w itilize NEXOVAX, ou dakò pou achte ak vann ak bòn fwa, respekte lwa peyi w ak peyi kote chak koli prale, epi swiv règ kontni maketplas la. Machann yo responsab pou enfòmasyon piblikasyon yo, pri ak envantè yo kòrèk, pou voye kòmand yo ak pou respekte règ ladwàn pou koli entènasyonal yo.'))),
    ('PRIVACY_POLICY', 'privacidad',
      jsonb_build_object(
        'es', jsonb_build_array('Política de privacidad', 'Usamos tus datos únicamente para operar tu cuenta, procesar pedidos, pagos y envíos, y dar soporte. Compartimos con las transportadoras solo los datos necesarios para entregar tus pedidos. Los datos sensibles (identificación fiscal y cuentas bancarias de vendedores) se almacenan cifrados. No vendemos tus datos a terceros.'),
        'en', jsonb_build_array('Privacy policy', 'We use your data only to operate your account, process orders, payments and shipments, and provide support. We share with carriers only the data needed to deliver your orders. Sensitive data (sellers’ tax IDs and bank accounts) is stored encrypted. We don’t sell your data to third parties.'),
        'fr', jsonb_build_array('Politique de confidentialité', 'Nous utilisons vos données uniquement pour gérer votre compte, traiter commandes, paiements et envois, et fournir le support. Nous ne partageons avec les transporteurs que les données nécessaires à la livraison de vos commandes. Les données sensibles (identifiants fiscaux et comptes bancaires des vendeurs) sont stockées chiffrées. Nous ne vendons pas vos données à des tiers.'),
        'ht', jsonb_build_array('Règ konfidansyalite', 'Nou itilize done ou sèlman pou fè kont ou mache, trete kòmand, peman ak livrezon, epi bay sipò. Nou pataje ak transpòtè yo sèlman done ki nesesè pou livre kòmand ou yo. Done sansib (nimewo fiskal ak kont labank machann yo) sere an chifre. Nou pa vann done ou bay lòt moun.'))),
    ('SELLER_TERMS', 'terminos-vendedores',
      jsonb_build_object(
        'es', jsonb_build_array('Términos para vendedores', 'Como vendedor en NEXOVAX aceptas: publicar solo productos legales, propios o autorizados, con descripciones, fotos, precios e inventario veraces; que cada producto pase por la moderación del marketplace y cumpla sus políticas de contenido; despachar a tiempo los pedidos pagados y registrar su seguimiento; atender cancelaciones y devoluciones según tu política y la del marketplace; la comisión por venta vigente del marketplace sobre el precio del producto (sin envío ni impuestos), que se descuenta de cada venta; y que tus fondos se liberan tras la entrega y pueden retenerse ante disputas, reembolsos o incidencias de pago.'),
        'en', jsonb_build_array('Seller terms', 'As a seller on NEXOVAX you agree: to list only legal products that you own or are authorized to sell, with accurate descriptions, photos, prices and inventory; that every product goes through the marketplace moderation and follows its content policies; to ship paid orders on time and record their tracking; to handle cancellations and returns under your policy and the marketplace’s; to the marketplace’s current commission per sale on the product price (excluding shipping and taxes), deducted from each sale; and that your funds are released after delivery and may be held during disputes, refunds or payment incidents.'),
        'fr', jsonb_build_array('Conditions vendeur', 'En tant que vendeur sur NEXOVAX, vous acceptez : de ne publier que des produits légaux, vous appartenant ou que vous êtes autorisé à vendre, avec des descriptions, photos, prix et stocks exacts ; que chaque produit passe par la modération de la marketplace et respecte ses politiques de contenu ; d’expédier à temps les commandes payées et d’en enregistrer le suivi ; de traiter les annulations et retours selon votre politique et celle de la marketplace ; la commission par vente en vigueur de la marketplace sur le prix du produit (hors livraison et taxes), déduite de chaque vente ; et que vos fonds sont libérés après la livraison et peuvent être retenus en cas de litiges, remboursements ou incidents de paiement.'),
        'ht', jsonb_build_array('Kondisyon pou machann', 'Kòm machann sou NEXOVAX ou dakò: pou pibliye sèlman pwodwi ki legal, ki pou ou oswa ou gen otorizasyon pou vann, ak deskripsyon, foto, pri ak envantè ki kòrèk; pou chak pwodwi pase nan moderasyon maketplas la epi respekte règ kontni li; pou voye kòmand ki peye yo alè epi anrejistre swivi yo; pou trete anilasyon ak retou selon règ pa w ak pa maketplas la; ak komisyon pou chak vant maketplas la aplike kounye a sou pri pwodwi a (san livrezon ak taks), ki retire sou chak vant; epi pou lajan ou lage apre livrezon epi li ka rete bloke lè gen diskisyon, ranbousman oswa ensidan peman.')))
  ) as x(code, slug, loc) loop
    continue when exists (select 1 from public.policies where code = p.code);
    insert into public.policies (code, policy_type_code, slug, default_locale) values (p.code, p.code, p.slug, 'es') returning id into v_policy;
    insert into public.policy_versions (policy_id, version_number) values (v_policy, 1) returning id into v_version;
    insert into public.policy_version_localizations (policy_version_id, locale, title, content_format, content)
    select v_version, l.key, l.value->>0, 'PLAIN_TEXT', jsonb_build_object('text', l.value->>1) from jsonb_each(p.loc) l;
    -- Published (and audited) on behalf of the marketplace owner: the first active super administrator.
    perform public.publish_policy_version(v_version, (
      select ur.user_id from public.user_roles ur join public.roles r on r.id = ur.role_id join public.users u on u.id = ur.user_id
       where r.code = 'SUPER_ADMIN' and ur.revoked_at is null and u.status = 'ACTIVE' order by u.created_at limit 1), now());
  end loop;
end $$;

create table if not exists public.nx_featured_products (
  product_id uuid primary key references public.products(id) on delete cascade,
  sort_order integer not null default 0,
  featured_by uuid references public.users(id) on delete set null,
  featured_at timestamptz not null default now()
);
alter table public.nx_featured_products enable row level security;
grant select, insert, update, delete on public.nx_featured_products to nexovax_api_runtime;
