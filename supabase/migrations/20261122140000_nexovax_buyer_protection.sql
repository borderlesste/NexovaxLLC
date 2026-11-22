-- NEXOVAX: «Protección al comprador» page (/proteccion-al-comprador).
--
--  * BUYER_PROTECTION: informational public policy (audience PUBLIC, acceptance NONE), edited and
--    versioned in Admin → Ajustes → Políticas legales, in es/en/fr/ht.
--  * It explains claims (deadlines, evidence, how NEXOVAX decides, store not answering), payments
--    (Stripe, the store's share is held until after delivery), refunds, chargebacks, what an
--    "identified store" means and lost/damaged parcels. The page adds the figures in force (return
--    window, who pays the return, payout hold, support response times) from the live rules, so the
--    text itself quotes no number that the admin can change elsewhere.

insert into public.policy_types (code, name, description, acceptance_mode, audience, is_system) values
  ('BUYER_PROTECTION', 'Protección al comprador', 'Reclamos, pagos, reembolsos, contracargos y verificación de tiendas.', 'NONE', 'PUBLIC', true)
on conflict (code) do nothing;

do $$
declare
  v_policy uuid; v_version uuid;
  loc jsonb := jsonb_build_object(
    'es', jsonb_build_array('Protección al comprador y pagos', $t$Qué cubre: si un pedido no llega, llega dañado, es un producto distinto o no coincide con lo descrito, NEXOVAX te ayuda a resolverlo y, si corresponde, te devuelve tu dinero.

Cómo reclamar: abre el pedido en Mi cuenta → Pedidos y solicita la devolución o escribe a la tienda. Si no hay solución, usa Ayuda → Reportar un problema con el número de pedido. Cada reporte recibe un número de caso (NX-REP-…) para seguirlo y escalarlo. Plazo: el indicado arriba, contado desde la entrega; si el pedido no llega, desde la fecha estimada de entrega.

Pruebas que aceptamos: fotos o video del producto y del empaque, capturas de la publicación, el número de seguimiento y los mensajes con la tienda.

Cómo decidimos: comparamos el producto recibido con la publicación, el seguimiento del transportista y las pruebas de ambas partes. La tienda tiene 3 días hábiles para responder; si no responde, decidimos con las pruebas disponibles. Si el pedido no llegó o no coincide con lo descrito, el reembolso cubre el producto y el envío que pagaste. El reembolso nunca supera lo que pagaste por el pedido.

Pagos: los pagos con tarjeta se procesan con Stripe; según el pedido también pueden estar disponibles PayPal o la transferencia bancaria. NEXOVAX cobra el pedido y retiene la parte de la tienda: la tienda recibe su dinero solo después de la entrega y del período de retención indicado arriba, y nunca mientras haya una devolución o disputa abierta. Los retiros de las tiendas se aprueban manualmente y solo a una cuenta de cobro verificada.

Reembolsos: se hacen al mismo método de pago usado en la compra. Según tu banco, pueden tardar de 5 a 10 días hábiles en verse.

Contracargos: si abres una disputa con tu banco o el emisor de tu tarjeta, la atendemos ante el procesador de pagos con las pruebas del pedido. Escríbenos primero: suele ser más rápido.

Tiendas identificadas: al registrarse, cada tienda declara su nombre o razón social, el tipo de entidad, su país, su identificación fiscal, su dirección y su teléfono, y verificamos manualmente su cuenta de cobro antes de pagarle. Hoy no revisamos documentos de identidad antes de que una tienda publique: «tienda identificada» significa que tenemos sus datos fiscales declarados y su cuenta de cobro verificada.

Envíos perdidos, dañados o sin seguimiento: si el seguimiento no muestra movimiento en 10 días hábiles, el número de seguimiento no es válido o el transportista confirma la pérdida o el daño, lo tratamos como pedido no recibido y te reembolsamos si la tienda no lo reemplaza. Los paquetes retenidos en aduana siguen lo indicado en los Términos y condiciones.

Si NEXOVAX dejara de operar: lo avisaríamos con antelación, los pedidos aún no enviados se reembolsarían y el dinero de los pedidos entregados se pagaría a cada tienda.$t$),
    'en', jsonb_build_array('Buyer protection and payments', $t$What it covers: if an order doesn’t arrive, arrives damaged, is a different item or isn’t as described, NEXOVAX helps you sort it out and, when it applies, gives your money back.

How to claim: open the order in My account → Orders and request a return or write to the store. If that doesn’t solve it, use Help → Report a problem with the order number. Every report gets a case number (NX-REP-…) to follow and escalate it. Deadline: the one shown above, counted from delivery; if the order doesn’t arrive, from the estimated delivery date.

Evidence we accept: photos or video of the item and packaging, screenshots of the listing, the tracking number and your messages with the store.

How we decide: we compare the item received with the listing, the carrier’s tracking and both parties’ evidence. The store has 3 business days to answer; if it doesn’t, we decide with the evidence available. If the order didn’t arrive or isn’t as described, the refund covers the item and the shipping you paid. A refund never exceeds what you paid for the order.

Payments: card payments are processed by Stripe; depending on the order, PayPal or bank transfer may also be available. NEXOVAX collects the order and holds the store’s share: the store only gets its money after delivery and the hold period shown above, and never while a return or dispute is open. Store payouts are approved manually and only to a verified payout account.

Refunds: they go back to the payment method used. Depending on your bank, they can take 5 to 10 business days to appear.

Chargebacks: if you open a dispute with your bank or card issuer, we handle it with the payment processor using the order’s evidence. Write to us first: it’s usually faster.

Identified stores: when signing up, every store declares its name or legal name, entity type, country, tax ID, address and phone, and we manually verify its payout account before paying it. Today we don’t check identity documents before a store lists products: “identified store” means we hold its declared tax details and a verified payout account.

Lost, damaged or untracked parcels: if tracking shows no movement for 10 business days, the tracking number isn’t valid or the carrier confirms loss or damage, we treat it as an order not received and refund you if the store doesn’t replace it. Parcels held at customs follow the Terms and conditions.

If NEXOVAX stopped operating: we would give notice in advance, orders not yet shipped would be refunded and the money for delivered orders would be paid to each store.$t$),
    'fr', jsonb_build_array('Protection de l’acheteur et paiements', $t$Ce qui est couvert : si une commande n’arrive pas, arrive endommagée, n’est pas le bon produit ou ne correspond pas à la description, NEXOVAX vous aide à régler le problème et, le cas échéant, vous rembourse.

Comment réclamer : ouvrez la commande dans Mon compte → Commandes et demandez un retour ou écrivez à la boutique. À défaut de solution, utilisez Aide → Signaler un problème avec le numéro de commande. Chaque signalement reçoit un numéro de dossier (NX-REP-…) pour le suivre et le faire remonter. Délai : celui indiqué ci-dessus, à compter de la livraison ; si la commande n’arrive pas, à compter de la date de livraison estimée.

Preuves acceptées : photos ou vidéo du produit et de l’emballage, captures de l’annonce, numéro de suivi et messages échangés avec la boutique.

Comment nous décidons : nous comparons le produit reçu à l’annonce, le suivi du transporteur et les preuves des deux parties. La boutique dispose de 3 jours ouvrés pour répondre ; sans réponse, nous décidons avec les preuves disponibles. Si la commande n’est pas arrivée ou ne correspond pas à la description, le remboursement couvre le produit et la livraison payée. Le remboursement ne dépasse jamais le montant payé pour la commande.

Paiements : les paiements par carte sont traités par Stripe ; selon la commande, PayPal ou le virement bancaire peuvent aussi être proposés. NEXOVAX encaisse la commande et conserve la part de la boutique : la boutique ne reçoit son argent qu’après la livraison et la période de rétention indiquée ci-dessus, et jamais tant qu’un retour ou un litige est ouvert. Les retraits des boutiques sont approuvés manuellement et uniquement vers un compte de versement vérifié.

Remboursements : ils sont effectués sur le moyen de paiement utilisé. Selon votre banque, ils peuvent mettre de 5 à 10 jours ouvrés à apparaître.

Rétrofacturations : si vous ouvrez un litige auprès de votre banque ou de l’émetteur de votre carte, nous le traitons auprès du prestataire de paiement avec les preuves de la commande. Écrivez-nous d’abord : c’est généralement plus rapide.

Boutiques identifiées : à l’inscription, chaque boutique déclare son nom ou sa raison sociale, son type d’entité, son pays, son identifiant fiscal, son adresse et son téléphone, et nous vérifions manuellement son compte de versement avant de la payer. Aujourd’hui, nous ne contrôlons pas de pièces d’identité avant qu’une boutique publie : « boutique identifiée » signifie que nous disposons de ses données fiscales déclarées et d’un compte de versement vérifié.

Colis perdus, endommagés ou sans suivi : si le suivi n’indique aucun mouvement pendant 10 jours ouvrés, si le numéro de suivi n’est pas valable ou si le transporteur confirme la perte ou le dommage, nous le traitons comme une commande non reçue et vous remboursons si la boutique ne la remplace pas. Les colis retenus en douane suivent les Conditions générales.

Si NEXOVAX cessait son activité : nous vous préviendrions à l’avance, les commandes non encore expédiées seraient remboursées et l’argent des commandes livrées serait versé à chaque boutique.$t$),
    'ht', jsonb_build_array('Pwoteksyon achtè ak peman', $t$Sa sa kouvri: si yon kòmand pa rive, li rive kase, se pa bon pwodwi a oswa li pa sanble ak deskripsyon an, NEXOVAX ede w rezoud sa epi, lè sa aplike, li remèt ou lajan w.

Kijan pou fè reklamasyon: louvri kòmand lan nan Kont mwen → Kòmand epi mande yon retou oswa ekri boutik la. Si sa pa rezoud pwoblèm nan, sèvi ak Èd → Rapòte yon pwoblèm ak nimewo kòmand lan. Chak rapò resevwa yon nimewo dosye (NX-REP-…) pou swiv li epi fè l monte pi wo. Delè: sa ki endike anlè a, apati livrezon an; si kòmand lan pa rive, apati dat livrezon yo te estime a.

Prèv nou aksepte: foto oswa videyo pwodwi a ak anbalaj la, kaptire piblikasyon an, nimewo swivi a ak mesaj ou te voye boutik la.

Kijan nou deside: nou konpare pwodwi ou resevwa a ak piblikasyon an, swivi transpòtè a ak prèv de pati yo. Boutik la gen 3 jou travay pou reponn; si li pa reponn, nou deside ak prèv ki genyen yo. Si kòmand lan pa t rive oswa li pa sanble ak deskripsyon an, ranbousman an kouvri pwodwi a ak livrezon ou te peye a. Ranbousman an pa janm depase sa ou te peye pou kòmand lan.

Peman: se Stripe ki trete peman ak kat; selon kòmand lan, PayPal oswa transfè bankè ka disponib tou. NEXOVAX touche kòmand lan epi kenbe pati boutik la: boutik la resevwa lajan l sèlman apre livrezon an ak peryòd retansyon ki endike anlè a, epi janm pandan gen yon retou oswa yon diskisyon ouvè. Yo apwouve retrè boutik yo alamen epi sèlman sou yon kont peman ki verifye.

Ranbousman: yo fèt sou menm metòd peman ou te itilize a. Selon bank ou, sa ka pran 5 a 10 jou travay pou parèt.

Kontestasyon bankè (chargeback): si w louvri yon diskisyon ak bank ou oswa konpayi kat ou, nou jere l ak sèvis peman an avèk prèv kòmand lan. Ekri nou anvan: li pi rapid an jeneral.

Boutik idantifye: lè l enskri, chak boutik deklare non l oswa non legal li, ki kalite antite li ye, peyi l, nimewo fiskal li, adrès li ak telefòn li, epi nou verifye kont peman li alamen anvan nou peye l. Jodi a nou pa verifye dokiman idantite anvan yon boutik pibliye: «boutik idantifye» vle di nou gen done fiskal li deklare yo ak yon kont peman ki verifye.

Koli ki pèdi, ki kase oswa san swivi: si swivi a pa montre okenn mouvman pandan 10 jou travay, nimewo swivi a pa valab oswa transpòtè a konfime pèt oswa domaj, nou trete sa tankou yon kòmand ki pa rive epi nou ranbouse w si boutik la pa ranplase l. Koli ki bloke nan ladwàn swiv sa Tèm ak kondisyon yo di.

Si NEXOVAX ta sispann fonksyone: nou ta avèti davans, kòmand ki poko voye yo ta ranbouse epi lajan kòmand ki livre yo ta peye bay chak boutik.$t$)
  );
begin
  if exists (select 1 from public.policies where code = 'BUYER_PROTECTION') then return; end if;
  insert into public.policies (code, policy_type_code, slug, default_locale) values ('BUYER_PROTECTION', 'BUYER_PROTECTION', 'proteccion-al-comprador', 'es') returning id into v_policy;
  insert into public.policy_versions (policy_id, version_number) values (v_policy, 1) returning id into v_version;
  insert into public.policy_version_localizations (policy_version_id, locale, title, content_format, content)
  select v_version, l.key, l.value->>0, 'PLAIN_TEXT', jsonb_build_object('text', l.value->>1) from jsonb_each(loc) l;
  perform public.publish_policy_version(v_version, (
    select ur.user_id from public.user_roles ur join public.roles r on r.id = ur.role_id join public.users u on u.id = ur.user_id
     where r.code = 'SUPER_ADMIN' and ur.revoked_at is null and u.status = 'ACTIVE' order by u.created_at limit 1), now());
end $$;
