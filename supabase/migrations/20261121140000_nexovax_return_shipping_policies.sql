-- NEXOVAX: public return and shipping policies (required by Google Merchant Center).
--
--  * Two informational policies in the policy engine: RETURN_POLICY (/politica-de-devoluciones)
--    and SHIPPING_POLICY (/politica-de-envios). Audience PUBLIC, acceptance NONE: nobody has to
--    accept them; they are edited and versioned in Admin → Ajustes → Políticas legales.
--  * The seeded text follows the rules in force at the time: 30 days from delivery, the customer
--    sends the item back, the original shipping is not refunded, inspection before the refund and
--    no restocking fee. The public returns page also shows the live conditions from the return rules.

insert into public.policy_types (code, name, description, acceptance_mode, audience, is_system) values
  ('RETURN_POLICY', 'Política de devoluciones', 'Plazos, condiciones y reembolsos de las devoluciones.', 'NONE', 'PUBLIC', true),
  ('SHIPPING_POLICY', 'Política de envíos', 'Destinos, costos, tiempos y seguimiento de los envíos.', 'NONE', 'PUBLIC', true)
on conflict (code) do nothing;

do $$
declare
  p record; v_policy uuid; v_version uuid;
begin
  for p in select * from (values
    ('RETURN_POLICY', 'politica-de-devoluciones',
      jsonb_build_object(
        'es', jsonb_build_array('Política de devoluciones y reembolsos', $t$En NEXOVAX todas las tiendas siguen la misma política de devoluciones.

Plazo: puedes solicitar la devolución de un producto dentro de los 30 días siguientes a la entrega del pedido.

Cómo solicitarla: entra en Mi cuenta → Pedidos, abre el pedido y elige «Solicitar devolución». Indica el motivo y, si el producto llegó dañado, es incorrecto o no coincide con la descripción, adjunta fotos. Recibirás la dirección a la que debes enviarlo.

Condiciones: el producto debe devolverse completo, con sus accesorios y empaque, y en el mismo estado en que se recibió.

Envío de la devolución: el cliente envía el producto a la tienda y cubre el costo del envío de vuelta. Te recomendamos usar un servicio con número de seguimiento.

Reembolso: cuando la tienda recibe e inspecciona el producto, emitimos el reembolso al mismo método de pago usado en la compra. El costo del envío original no se reembolsa y no cobramos cargo por reposición. Según tu banco, el dinero puede tardar entre 5 y 10 días hábiles en reflejarse.

Cambios: si quieres otra talla, color o modelo, solicita la devolución y haz un pedido nuevo.

Cancelaciones: mientras la tienda no haya enviado el pedido puedes solicitar su cancelación desde el detalle del pedido; si se aprueba, el reembolso es total.

¿Necesitas ayuda? Escríbenos desde Ayuda → Reportar un problema.$t$),
        'en', jsonb_build_array('Return and refund policy', $t$On NEXOVAX every store follows the same return policy.

Return window: you can request a return within 30 days after your order is delivered.

How to request it: go to My account → Orders, open the order and choose “Request a return”. Tell us the reason and, if the item arrived damaged, is the wrong item or doesn’t match its description, attach photos. You will receive the address to send it to.

Conditions: the item must be returned complete, with its accessories and packaging, and in the same condition in which it was received.

Return shipping: the customer sends the item back to the store and pays for the return shipping. We recommend using a service with a tracking number.

Refund: once the store receives and inspects the item, we issue the refund to the original payment method. The original shipping cost is not refunded and there is no restocking fee. Depending on your bank, the money may take 5 to 10 business days to appear.

Exchanges: if you want a different size, color or model, request a return and place a new order.

Cancellations: while the store hasn’t shipped the order you can request its cancellation from the order details; if approved, you get a full refund.

Need help? Contact us from Help → Report a problem.$t$),
        'fr', jsonb_build_array('Politique de retour et de remboursement', $t$Sur NEXOVAX, toutes les boutiques appliquent la même politique de retour.

Délai : vous pouvez demander le retour d’un produit dans les 30 jours suivant la livraison de la commande.

Comment le demander : allez dans Mon compte → Commandes, ouvrez la commande et choisissez « Demander un retour ». Indiquez le motif et, si le produit est arrivé endommagé, n’est pas le bon ou ne correspond pas à sa description, joignez des photos. Vous recevrez l’adresse à laquelle l’envoyer.

Conditions : le produit doit être retourné complet, avec ses accessoires et son emballage, et dans l’état où il a été reçu.

Envoi du retour : le client renvoie le produit à la boutique et prend en charge les frais de retour. Nous vous conseillons un service avec numéro de suivi.

Remboursement : dès que la boutique reçoit et inspecte le produit, nous remboursons le moyen de paiement utilisé lors de l’achat. Les frais de livraison initiaux ne sont pas remboursés et aucuns frais de remise en stock ne sont appliqués. Selon votre banque, l’argent peut mettre de 5 à 10 jours ouvrés à apparaître.

Échanges : si vous souhaitez une autre taille, couleur ou modèle, demandez un retour et passez une nouvelle commande.

Annulations : tant que la boutique n’a pas expédié la commande, vous pouvez demander son annulation depuis le détail de la commande ; si elle est acceptée, le remboursement est total.

Besoin d’aide ? Écrivez-nous depuis Aide → Signaler un problème.$t$),
        'ht', jsonb_build_array('Règ pou retou ak ranbousman', $t$Sou NEXOVAX tout boutik swiv menm règ pou retou.

Delè: ou ka mande retou yon pwodwi nan 30 jou apre yo fin livre kòmand ou.

Kijan pou mande l: ale nan Kont mwen → Kòmand, louvri kòmand lan epi chwazi «Mande yon retou». Di nou rezon an epi, si pwodwi a rive kase, se pa bon pwodwi a oswa li pa sanble ak deskripsyon an, mete foto. W ap resevwa adrès kote pou w voye l.

Kondisyon: fòk pwodwi a retounen konplè, ak akseswa l ak anbalaj li, nan menm eta ou te resevwa l la.

Voye retou a: kliyan an voye pwodwi a tounen bay boutik la epi li peye frè pou voye l tounen. Nou konseye w sèvi ak yon sèvis ki bay nimewo swivi.

Ranbousman: lè boutik la resevwa epi tcheke pwodwi a, nou ranbouse w sou menm mwayen peman ou te itilize a. Frè livrezon orijinal la pa ranbouse epi nou pa fè w peye frè pou remèt pwodwi nan estòk. Selon bank ou, lajan an ka pran 5 a 10 jou travay pou parèt.

Echanj: si w vle yon lòt gwosè, koulè oswa modèl, mande retou a epi fè yon nouvo kòmand.

Anilasyon: toutotan boutik la poko voye kòmand lan, ou ka mande anile l nan detay kòmand lan; si yo apwouve l, ou resevwa tout lajan w.

Ou bezwen èd? Ekri nou nan Èd → Rapòte yon pwoblèm.$t$))),
    ('SHIPPING_POLICY', 'politica-de-envios',
      jsonb_build_object(
        'es', jsonb_build_array('Política de envíos', $t$NEXOVAX es un marketplace: cada tienda prepara y envía sus propios pedidos.

Destinos: enviamos a los países disponibles en el selector «Enviar a» del sitio. Algunas tiendas o productos solo se envían a ciertos países; la ficha del producto y el checkout te lo indican antes de pagar.

Costo del envío: se calcula en el checkout según la dirección de entrega, el peso y tamaño del paquete y el servicio que elijas (tarifas en vivo de las transportadoras o tarifas del marketplace). Siempre ves el costo total antes de pagar. Si tu pedido incluye productos de varias tiendas, cada tienda envía su parte por separado.

Tiempo de preparación: las tiendas despachan los pedidos pagados normalmente en un plazo de 1 a 3 días hábiles.

Tiempo de entrega: el checkout muestra el tiempo estimado de cada opción de envío. Es una estimación de la transportadora y puede variar por el destino, la aduana o causas ajenas a la tienda.

Seguimiento: cuando la tienda envía tu pedido te avisamos con el número de seguimiento, y puedes consultarlo en Mi cuenta → Pedidos.

Retiro en tienda: si la tienda lo ofrece y estás en su mismo país, puedes elegir retirar el pedido en la tienda.

Envíos internacionales: los impuestos de importación, aranceles y trámites de aduana del país de destino pueden aplicar y corren por cuenta del comprador, salvo que el checkout indique lo contrario.

Problemas con la entrega: si tu pedido no llega, llega dañado o incompleto, repórtalo desde el detalle del pedido o en Ayuda → Reportar un problema y lo resolveremos con la tienda.$t$),
        'en', jsonb_build_array('Shipping policy', $t$NEXOVAX is a marketplace: each store prepares and ships its own orders.

Destinations: we ship to the countries available in the site’s “Deliver to” selector. Some stores or products only ship to certain countries; the product page and the checkout tell you before you pay.

Shipping cost: it is calculated at checkout from the delivery address, the package weight and size, and the service you choose (live carrier rates or marketplace rates). You always see the total cost before paying. If your order includes products from several stores, each store ships its part separately.

Handling time: stores usually ship paid orders within 1 to 3 business days.

Delivery time: the checkout shows the estimated time of each shipping option. It is the carrier’s estimate and may vary with the destination, customs or causes beyond the store’s control.

Tracking: when the store ships your order we send you the tracking number, and you can follow it in My account → Orders.

Store pickup: if the store offers it and you are in the same country, you can choose to pick up the order at the store.

International shipping: import taxes, duties and customs procedures of the destination country may apply and are paid by the buyer, unless the checkout says otherwise.

Delivery problems: if your order doesn’t arrive, or arrives damaged or incomplete, report it from the order details or in Help → Report a problem and we will resolve it with the store.$t$),
        'fr', jsonb_build_array('Politique de livraison', $t$NEXOVAX est une marketplace : chaque boutique prépare et expédie ses propres commandes.

Destinations : nous livrons dans les pays proposés dans le sélecteur « Envoyer à » du site. Certaines boutiques ou certains produits ne sont livrés que dans certains pays ; la fiche produit et le paiement vous l’indiquent avant de payer.

Frais de livraison : ils sont calculés au paiement selon l’adresse de livraison, le poids et la taille du colis et le service choisi (tarifs en direct des transporteurs ou tarifs de la marketplace). Vous voyez toujours le coût total avant de payer. Si votre commande contient des produits de plusieurs boutiques, chaque boutique expédie sa partie séparément.

Délai de préparation : les boutiques expédient en général les commandes payées sous 1 à 3 jours ouvrés.

Délai de livraison : le paiement affiche le délai estimé de chaque option de livraison. C’est une estimation du transporteur, qui peut varier selon la destination, la douane ou des causes indépendantes de la boutique.

Suivi : lorsque la boutique expédie votre commande, nous vous envoyons le numéro de suivi, consultable dans Mon compte → Commandes.

Retrait en boutique : si la boutique le propose et que vous êtes dans le même pays, vous pouvez retirer la commande en boutique.

Envois internationaux : les taxes d’importation, droits de douane et formalités du pays de destination peuvent s’appliquer et sont à la charge de l’acheteur, sauf indication contraire au paiement.

Problèmes de livraison : si votre commande n’arrive pas, arrive endommagée ou incomplète, signalez-le depuis le détail de la commande ou dans Aide → Signaler un problème et nous le réglerons avec la boutique.$t$),
        'ht', jsonb_build_array('Règ pou livrezon', $t$NEXOVAX se yon maketplas: chak boutik prepare epi voye pwòp kòmand pa l.

Destinasyon: nou voye nan peyi ki disponib nan seleksyon «Voye bay» sou sit la. Gen kèk boutik oswa pwodwi ki voye sèlman nan kèk peyi; fich pwodwi a ak kès la di w sa anvan w peye.

Pri livrezon: yo kalkile l nan kès la selon adrès livrezon an, pwa ak gwosè pake a ak sèvis ou chwazi a (pri an dirèk transpòtè yo oswa pri maketplas la). Ou toujou wè pri total la anvan w peye. Si kòmand ou gen pwodwi plizyè boutik, chak boutik voye pa l apa.

Tan preparasyon: boutik yo konn voye kòmand ki peye yo nan 1 a 3 jou travay.

Tan livrezon: kès la montre tan estimasyon chak opsyon livrezon. Se yon estimasyon transpòtè a epi li ka chanje selon destinasyon an, ladwàn oswa lòt rezon boutik la pa kontwole.

Swivi: lè boutik la voye kòmand ou, nou voye nimewo swivi a ba ou, epi ou ka swiv li nan Kont mwen → Kòmand.

Ranmase nan boutik: si boutik la ofri l epi ou nan menm peyi a, ou ka chwazi vin chèche kòmand lan nan boutik la.

Livrezon entènasyonal: taks enpòtasyon, dwa ladwàn ak demach ladwàn peyi destinasyon an ka aplike epi se achtè a ki peye yo, sof si kès la di lòt bagay.

Pwoblèm livrezon: si kòmand ou pa rive, rive kase oswa pa konplè, rapòte l nan detay kòmand lan oswa nan Èd → Rapòte yon pwoblèm epi n ap rezoud li ak boutik la.$t$)))
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
