-- NEXOVAX: legal pages and help center aligned with each other and with what the platform does
-- (2026-11-27 audit). Explicit es/en/fr/ht. Everything stays editable in the admin panel:
--   * Admin → Ajustes → Políticas legales: RETURN_POLICY v12, BUYER_PROTECTION v2, ABOUT_US v2, SELLER_TERMS v2.
--   * Admin → Configuración → Ayuda y redes: the «¿Puedo devolver un producto?» FAQ answer and the
--     «Devoluciones» section of the seller guide (only those two items are replaced).
--
-- Rules the texts describe (source of truth = the live rules, which the pages show next to the text):
--   * One NEXOVAX return policy for every store; window, who pays the return label, original-shipping
--     refund and restocking fee come from Admin → Devoluciones and are shown in «Condiciones vigentes».
--     The texts quote no number the admin can change there.
--   * Return label: «Según el motivo» (BY_REASON) — the store pays a prepaid label when the reason is the
--     store's fault (damaged, wrong item, missing parts, not as described), deducted from its balance;
--     otherwise the customer ships it and pays. Switch it in Admin → Devoluciones.
--   * Refunds cover the returned products and their proportional taxes; the original shipping follows
--     the «Envío original» rule (today: not refunded). Same calculation for «Reembolsar sin devolución».
--   * Store payout: after delivery and the hold period (the longer of the payout policy hold and
--     Admin → Configuración → Seguridad), never with an open return or dispute.
--   * Stores sell right after registering; «Tienda verificada» = staff reviewed the declared tax details
--     (button «Verificar datos fiscales»); no identity documents; payout accounts verified manually.
--   * Card payments by Stripe, PayPal and bank transfer when enabled.
--
-- Policies are published without re-acceptance, except SELLER_TERMS v2 (new obligation: return labels
-- for the store's own errors), which sellers accept again on their next visit.
-- Idempotent: a version is skipped when one with the same Spanish text already exists.

do $$
declare
  p record; v_policy uuid; v_version uuid; v_next int; v_admin uuid;
begin
  select ur.user_id into v_admin from public.user_roles ur join public.roles r on r.id = ur.role_id join public.users u on u.id = ur.user_id
   where r.code = 'SUPER_ADMIN' and ur.revoked_at is null and u.status = 'ACTIVE' order by u.created_at limit 1;
  for p in select * from (values

  -- ------------------------------------------------------------------------------------------ RETURN_POLICY
  ('RETURN_POLICY', false, jsonb_build_object(
    'es', jsonb_build_array('Política de devoluciones y reembolsos', $t$En NEXOVAX todas las tiendas siguen la misma política de devoluciones y reembolsos: ninguna tienda puede fijar una propia. Las condiciones vigentes (plazo, quién paga el envío de la devolución, reembolso del envío original y cargos) aparecen arriba, en «Condiciones vigentes», y se aplican tal como estaban el día en que solicitas la devolución.

1. Plazo para solicitar una devolución

Puedes solicitar una devolución dentro del plazo indicado en «Condiciones vigentes», contado desde la entrega confirmada del pedido. Las solicitudes fuera de plazo pueden rechazarse, salvo que la ley aplicable o tus derechos irrenunciables como consumidor digan otra cosa. Una solicitud presentada a tiempo sigue siendo válida aunque su revisión termine después del plazo.

2. Cómo solicitarla

1. Entra en Mi cuenta → Pedidos.
2. Abre el pedido.
3. Pulsa «Solicitar devolución».
4. Elige el motivo y explícalo.
5. Si el producto llegó dañado o defectuoso, incompleto, es distinto del que pediste o no coincide con la descripción, adjunta fotos u otras pruebas.

La tienda revisa la solicitud y, si la aprueba, verás en el pedido las instrucciones y la dirección de devolución.

3. Quién paga el envío de la devolución

A. Problema de la tienda — paga la tienda. Si el producto llegó dañado o defectuoso, es distinto del que pediste (otra talla, color o modelo), llegó incompleto o no coincide con su descripción, la tienda paga la etiqueta de devolución: la generamos desde el pedido y su costo se descuenta del saldo de la tienda. Si la revisión demuestra que el motivo indicado no es cierto, la devolución puede rechazarse.

B. Error o cambio de opinión del cliente — paga el cliente. Si elegiste por error la talla, el color o el modelo, o ya no quieres el producto, y la tienda entregó exactamente lo que pediste y tal como se describía, envías el producto por correo por tu cuenta y pagas el envío de vuelta. Te recomendamos un servicio con número de seguimiento.

No cobramos cargo por reposición, salvo que «Condiciones vigentes» indique otra cosa.

4. Estado del producto

Para una devolución por error o cambio de opinión, el producto debe volver en el mismo estado en que lo recibiste, con todos sus accesorios y, cuando sea posible, en su empaque original. Los productos reportados como dañados, defectuosos, incorrectos o distintos de lo descrito se evalúan según su estado al entregarse y las pruebas aportadas.

5. Reembolsos

Cuando la tienda recibe e inspecciona el producto, reembolsamos al método de pago original el precio de los productos devueltos y la parte proporcional de sus impuestos. El envío original del pedido se reembolsa solo si «Condiciones vigentes» lo indica o si la ley lo exige. Según tu banco o proveedor de pagos, el reembolso puede tardar de 5 a 10 días hábiles en verse.

Si un paquete se pierde o llega en un estado que no permite devolverlo, NEXOVAX puede reembolsarte sin que envíes nada, con el mismo cálculo. Los pedidos que no llegan siguen lo indicado en la Protección al comprador.

6. Cambios y reemplazos

No hacemos cambios: si quieres otra talla, color o modelo, solicita la devolución dentro del plazo y haz un nuevo pedido. Si el problema es de la tienda, esta puede ofrecerte un reemplazo, pero no estás obligado a aceptarlo en lugar del reembolso que te corresponde.

7. Responsabilidad de la tienda

Las tiendas responden por los reembolsos y por las etiquetas de devolución de los problemas que son suyos. NEXOVAX descuenta esos importes del saldo disponible de la tienda o de sus fondos pendientes; si no alcanzan, la tienda queda debiendo la diferencia. Si una tienda no cumple, NEXOVAX puede retener sus pagos o suspender temporalmente su cuenta hasta que lo resuelva, después de avisarle y darle la oportunidad de responder.

8. Fondos retenidos durante la devolución

La parte de la tienda de cada pedido queda retenida durante el período indicado en la Protección al comprador después de la entrega, y nunca se libera mientras haya una devolución o un reclamo abierto sobre ese pedido.

9. Cancelaciones

Puedes solicitar la cancelación desde el detalle del pedido antes de que la tienda lo envíe. Si se aprueba, te reembolsamos el total al método de pago original.

10. Resolución de disputas

NEXOVAX puede revisar el pedido, la publicación, las fotos, el seguimiento del envío y otras pruebas para decidir quién es responsable, y pedir información a ambas partes. Nada de esta política limita tus derechos irrenunciables como consumidor ni tus derechos ante tu banco o emisor de tarjeta (contracargos).

11. Ayuda

Para devoluciones, reembolsos o desacuerdos con una tienda, usa Ayuda → Reportar un problema.$t$),
    'en', jsonb_build_array('Return and refund policy', $t$At NEXOVAX every store follows the same return and refund policy: no store can set its own. The conditions in force (window, who pays return shipping, original-shipping refund and fees) are shown above under “Current conditions” and apply as they were on the day you request the return.

1. Return window

You can request a return within the window shown under “Current conditions”, counted from the confirmed delivery of the order. Late requests may be declined unless applicable law or your non-waivable consumer rights say otherwise. A request made on time remains valid even if its review ends after the window.

2. How to request it

1. Go to My account → Orders.
2. Open the order.
3. Select “Request a return”.
4. Choose the reason and explain it.
5. If the item arrived damaged or defective, incomplete, is different from what you ordered or isn’t as described, attach photos or other evidence.

The store reviews the request and, if it approves it, the order shows the return instructions and address.

3. Who pays return shipping

A. Store’s problem — the store pays. If the item arrived damaged or defective, is different from what you ordered (another size, color or model), arrived incomplete or isn’t as described, the store pays the return label: we create it from the order and its cost is deducted from the store’s balance. If the review shows the stated reason isn’t true, the return may be declined.

B. Customer’s mistake or change of mind — the customer pays. If you picked the wrong size, color or model, or no longer want the item, and the store delivered exactly what you ordered as described, you mail the item back yourself and pay the return shipping. We recommend a tracked service.

There is no restocking fee unless “Current conditions” says otherwise.

4. Condition of the item

For a return due to a mistake or change of mind, the item must come back in the condition you received it, with all its accessories and, where possible, in its original packaging. Items reported as damaged, defective, wrong or not as described are assessed on their condition at delivery and the evidence provided.

5. Refunds

Once the store receives and inspects the item, we refund the price of the returned products and their proportional taxes to the original payment method. The order’s original shipping is refunded only if “Current conditions” says so or the law requires it. Depending on your bank or payment provider, the refund can take 5 to 10 business days to appear.

If a parcel is lost or arrives in a state that can’t be returned, NEXOVAX may refund you without you sending anything back, with the same calculation. Orders that never arrive follow the Buyer protection.

6. Exchanges and replacements

We don’t do exchanges: for another size, color or model, request a return within the window and place a new order. If the problem is the store’s, it may offer a replacement, but you don’t have to accept it instead of the refund you’re entitled to.

7. Store responsibility

Stores are responsible for refunds and return labels for problems that are theirs. NEXOVAX deducts those amounts from the store’s available balance or pending funds; if they aren’t enough, the store owes the difference. If a store doesn’t comply, NEXOVAX may hold its payouts or temporarily suspend its account until it is resolved, after notifying it and giving it a chance to respond.

8. Funds held during a return

The store’s share of each order is held for the period shown in the Buyer protection after delivery, and is never released while a return or claim is open on that order.

9. Cancellations

You can request cancellation from the order details before the store ships it. If approved, we refund the full amount to the original payment method.

10. Dispute resolution

NEXOVAX may review the order, the listing, photos, shipping tracking and other evidence to decide who is responsible, and may ask both parties for information. Nothing in this policy limits your non-waivable consumer rights or your rights with your bank or card issuer (chargebacks).

11. Help

For returns, refunds or disagreements with a store, use Help → Report a problem.$t$),
    'fr', jsonb_build_array('Politique de retour et de remboursement', $t$Sur NEXOVAX, toutes les boutiques suivent la même politique de retour et de remboursement : aucune boutique ne peut fixer la sienne. Les conditions en vigueur (délai, qui paie le retour, remboursement de la livraison d’origine et frais) figurent ci-dessus, dans « Conditions en vigueur », et s’appliquent telles qu’elles étaient le jour de votre demande.

1. Délai de retour

Vous pouvez demander un retour dans le délai indiqué dans « Conditions en vigueur », à compter de la livraison confirmée de la commande. Les demandes tardives peuvent être refusées, sauf si la loi applicable ou vos droits impératifs de consommateur en disposent autrement. Une demande faite à temps reste valable même si son examen se termine après le délai.

2. Comment le demander

1. Allez dans Mon compte → Commandes.
2. Ouvrez la commande.
3. Cliquez sur « Demander un retour ».
4. Choisissez le motif et expliquez-le.
5. Si le produit est arrivé endommagé ou défectueux, incomplet, n’est pas celui commandé ou ne correspond pas à la description, joignez des photos ou d’autres preuves.

La boutique examine la demande et, si elle l’approuve, la commande affiche les instructions et l’adresse de retour.

3. Qui paie le retour

A. Problème de la boutique — la boutique paie. Si le produit est arrivé endommagé ou défectueux, n’est pas celui commandé (autre taille, couleur ou modèle), est incomplet ou ne correspond pas à sa description, la boutique paie l’étiquette de retour : nous la créons depuis la commande et son coût est déduit du solde de la boutique. Si l’examen montre que le motif indiqué n’est pas exact, le retour peut être refusé.

B. Erreur ou changement d’avis du client — le client paie. Si vous avez choisi par erreur la taille, la couleur ou le modèle, ou ne voulez plus le produit, et que la boutique a livré exactement ce que vous aviez commandé tel que décrit, vous renvoyez le produit par la poste à vos frais. Nous recommandons un service avec suivi.

Aucuns frais de remise en stock, sauf indication contraire dans « Conditions en vigueur ».

4. État du produit

Pour un retour après une erreur ou un changement d’avis, le produit doit revenir dans l’état où vous l’avez reçu, avec tous ses accessoires et, si possible, dans son emballage d’origine. Les produits signalés comme endommagés, défectueux, erronés ou non conformes sont évalués selon leur état à la livraison et les preuves fournies.

5. Remboursements

Une fois le produit reçu et inspecté par la boutique, nous remboursons sur le moyen de paiement d’origine le prix des produits retournés et la part proportionnelle de leurs taxes. La livraison d’origine n’est remboursée que si « Conditions en vigueur » l’indique ou si la loi l’exige. Selon votre banque ou votre prestataire de paiement, le remboursement peut mettre de 5 à 10 jours ouvrés à apparaître.

Si un colis est perdu ou arrive dans un état qui ne permet pas de le renvoyer, NEXOVAX peut vous rembourser sans retour, avec le même calcul. Les commandes qui n’arrivent pas suivent la Protection de l’acheteur.

6. Échanges et remplacements

Nous ne faisons pas d’échanges : pour une autre taille, couleur ou modèle, demandez un retour dans le délai et passez une nouvelle commande. Si le problème vient de la boutique, elle peut proposer un remplacement, mais vous n’êtes pas obligé de l’accepter à la place du remboursement auquel vous avez droit.

7. Responsabilité de la boutique

Les boutiques répondent des remboursements et des étiquettes de retour liés à leurs propres problèmes. NEXOVAX déduit ces montants du solde disponible de la boutique ou de ses fonds en attente ; s’ils ne suffisent pas, la boutique reste redevable de la différence. Si une boutique ne s’exécute pas, NEXOVAX peut retenir ses versements ou suspendre temporairement son compte jusqu’à régularisation, après l’avoir prévenue et lui avoir permis de répondre.

8. Fonds retenus pendant un retour

La part de la boutique de chaque commande est retenue pendant la période indiquée dans la Protection de l’acheteur après la livraison, et n’est jamais libérée tant qu’un retour ou une réclamation est ouvert sur cette commande.

9. Annulations

Vous pouvez demander l’annulation depuis le détail de la commande avant son expédition. Si elle est acceptée, nous remboursons la totalité sur le moyen de paiement d’origine.

10. Règlement des litiges

NEXOVAX peut examiner la commande, l’annonce, les photos, le suivi de l’envoi et d’autres preuves pour déterminer la responsabilité, et demander des informations aux deux parties. Rien dans cette politique ne limite vos droits impératifs de consommateur ni vos droits auprès de votre banque ou de l’émetteur de votre carte (rétrofacturations).

11. Aide

Pour les retours, remboursements ou désaccords avec une boutique, utilisez Aide → Signaler un problème.$t$),
    'ht', jsonb_build_array('Politik retou ak ranbousman', $t$Sou NEXOVAX tout boutik yo swiv menm politik retou ak ranbousman an: okenn boutik pa ka fikse pa l. Kondisyon ki an vigè yo (delè, kiyès ki peye livrezon retou a, ranbousman livrezon orijinal la ak frè) parèt anlè a, nan « Kondisyon an vigè », epi yo aplike jan yo te ye jou ou mande retou a.

1. Delè pou mande yon retou

Ou ka mande yon retou nan delè ki endike nan « Kondisyon an vigè », apati livrezon kòmand lan konfime. Yo ka refize demann ki an reta, sof si lalwa oswa dwa ou kòm konsomatè ki pa ka retire di lòt bagay. Yon demann ou fè atan rete valab menm si revizyon an fini apre delè a.

2. Kijan pou mande l

1. Ale nan Kont mwen → Kòmand.
2. Louvri kòmand lan.
3. Peze « Mande yon retou ».
4. Chwazi rezon an epi esplike l.
5. Si pwodwi a rive kase oswa defektye, li pa konplè, se pa sa ou te kòmande oswa li pa sanble ak deskripsyon an, mete foto oswa lòt prèv.

Boutik la revize demann lan epi, si li apwouve l, kòmand lan ap montre enstriksyon yo ak adrès retou a.

3. Kiyès ki peye livrezon retou a

A. Pwoblèm boutik la — boutik la peye. Si pwodwi a rive kase oswa defektye, se pa sa ou te kòmande (lòt gwosè, koulè oswa modèl), li pa konplè oswa li pa sanble ak deskripsyon l, boutik la peye etikèt retou a: nou kreye l depi nan kòmand lan epi yo retire pri a nan balans boutik la. Si revizyon an montre rezon ou bay la pa vre, yo ka refize retou a.

B. Erè oswa chanjman lide kliyan an — kliyan an peye. Si w te chwazi move gwosè, koulè oswa modèl pa erè, oswa ou pa vle pwodwi a ankò, epi boutik la te livre egzakteman sa w te kòmande jan yo te dekri l, ou voye pwodwi a pa lapòs pou kont ou epi ou peye livrezon retou a. Nou rekòmande yon sèvis ki gen nimewo swivi.

Pa gen frè pou remete an stòk, sof si « Kondisyon an vigè » di lòt bagay.

4. Eta pwodwi a

Pou yon retou akoz yon erè oswa yon chanjman lide, pwodwi a dwe retounen nan menm eta ou te resevwa l la, ak tout akseswa li yo epi, lè sa posib, nan anbalaj orijinal li. Pwodwi yo rapòte kòm kase, defektye, pa bon oswa ki pa sanble ak deskripsyon an evalye selon eta yo lè yo te livre ak prèv yo bay.

5. Ranbousman

Lè boutik la resevwa epi enspekte pwodwi a, nou ranbouse sou menm mwayen peman an pri pwodwi ou retounen yo ak pati taks ki ale ak yo. Livrezon orijinal kòmand lan ranbouse sèlman si « Kondisyon an vigè » di sa oswa si lalwa egzije l. Selon bank ou oswa sèvis peman ou, ranbousman an ka pran 5 a 10 jou ouvrab pou parèt.

Si yon pake pèdi oswa li rive nan yon eta ki pa pèmèt retounen l, NEXOVAX ka ranbouse w san ou pa voye anyen, ak menm kalkil la. Kòmand ki pa janm rive swiv sa Pwoteksyon achtè a di.

6. Echanj ak ranplasman

Nou pa fè echanj: pou yon lòt gwosè, koulè oswa modèl, mande retou a nan delè a epi fè yon nouvo kòmand. Si pwoblèm nan se pou boutik la, li ka ofri w yon ranplasman, men ou pa oblije aksepte l olye ranbousman ou gen dwa a.

7. Responsablite boutik la

Boutik yo reponsab ranbousman ak etikèt retou pou pwoblèm ki pou yo. NEXOVAX retire montan sa yo nan balans disponib boutik la oswa nan lajan l ki an atant; si sa pa ase, boutik la rete dwe diferans lan. Si yon boutik pa respekte sa, NEXOVAX ka kenbe peman l oswa sispann kont li pou yon ti tan jiskaske sa rezoud, apre li fin avèti l epi ba l chans pou l reponn.

8. Lajan ki kenbe pandan yon retou

Pati boutik la nan chak kòmand rete kenbe pandan peryòd ki endike nan Pwoteksyon achtè a apre livrezon an, epi li pa janm lage pandan gen yon retou oswa yon reklamasyon ki louvri sou kòmand sa a.

9. Anilasyon

Ou ka mande anile kòmand lan depi nan detay li anvan boutik la voye l. Si yo apwouve sa, nou ranbouse tout lajan an sou menm mwayen peman an.

10. Rezoud diskisyon

NEXOVAX ka revize kòmand lan, piblikasyon an, foto yo, swivi livrezon an ak lòt prèv pou deside kiyès ki responsab, epi mande de pati yo enfòmasyon. Anyen nan politik sa a pa limite dwa ou kòm konsomatè ki pa ka retire ni dwa ou devan bank ou oswa konpayi kat ou (chargeback).

11. Èd

Pou retou, ranbousman oswa dezakò ak yon boutik, sèvi ak Èd → Rapòte yon pwoblèm.$t$))),

  -- ------------------------------------------------------------------------------------------ BUYER_PROTECTION
  ('BUYER_PROTECTION', false, jsonb_build_object(
    'es', jsonb_build_array('Protección al comprador y pagos', $t$Qué cubre: si un pedido no llega, llega dañado, es un producto distinto o no coincide con lo descrito, NEXOVAX te ayuda a resolverlo y, si corresponde, te devuelve tu dinero.

Cómo reclamar: abre el pedido en Mi cuenta → Pedidos y solicita la devolución o escribe a la tienda. Si no hay solución, usa Ayuda → Reportar un problema con el número de pedido. Cada reporte recibe un número de caso (NX-REP-…) para seguirlo y escalarlo. Plazo: el indicado arriba, contado desde la entrega; si el pedido no llega, desde la fecha estimada de entrega.

Pruebas que aceptamos: fotos o video del producto y del empaque, capturas de la publicación, el número de seguimiento y los mensajes con la tienda.

Cómo decidimos: comparamos el producto recibido con la publicación, el seguimiento del transportista y las pruebas de ambas partes. La tienda tiene 3 días hábiles para responder; si no responde, decidimos con las pruebas disponibles. Si el problema es de la tienda (dañado, distinto, incompleto o no coincide con lo descrito), la tienda paga la etiqueta de devolución. El reembolso cubre el precio de los productos y sus impuestos; el envío original sigue la regla «Envío original» de la Política de devoluciones. El reembolso nunca supera lo que pagaste por el pedido.

Pagos: los pagos con tarjeta se procesan con Stripe; según el pedido también pueden estar disponibles PayPal o la transferencia bancaria. NEXOVAX cobra el pedido y retiene la parte de la tienda: la tienda recibe su dinero solo después de la entrega y del período de retención indicado arriba, y nunca mientras haya una devolución o disputa abierta. Los retiros de las tiendas se aprueban manualmente y solo a una cuenta de cobro verificada.

Reembolsos: se hacen al mismo método de pago usado en la compra. Según tu banco, pueden tardar de 5 a 10 días hábiles en verse.

Contracargos: si abres una disputa con tu banco o el emisor de tu tarjeta, la atendemos ante el procesador de pagos con las pruebas del pedido. Escríbenos primero: suele ser más rápido.

Tiendas identificadas y verificadas: al registrarse, cada tienda declara su nombre o razón social, el tipo de entidad, su país, su identificación fiscal, su dirección y su teléfono, y puede empezar a vender desde ese momento. Verificamos manualmente su cuenta de cobro antes de pagarle. La insignia «Tienda verificada» aparece cuando nuestro equipo ha revisado los datos fiscales que la tienda declaró; no revisamos documentos de identidad.

Envíos perdidos, dañados o sin seguimiento: si el seguimiento no muestra movimiento en 10 días hábiles, el número de seguimiento no es válido o el transportista confirma la pérdida o el daño, lo tratamos como pedido no recibido y te reembolsamos si la tienda no lo reemplaza. Los paquetes retenidos en aduana siguen lo indicado en los Términos y condiciones.

Si NEXOVAX dejara de operar: lo avisaríamos con antelación, los pedidos aún no enviados se reembolsarían y el dinero de los pedidos entregados se pagaría a cada tienda.$t$),
    'en', jsonb_build_array('Buyer protection and payments', $t$What it covers: if an order doesn’t arrive, arrives damaged, is a different item or isn’t as described, NEXOVAX helps you sort it out and, when it applies, gives your money back.

How to claim: open the order in My account → Orders and request a return or write to the store. If that doesn’t solve it, use Help → Report a problem with the order number. Every report gets a case number (NX-REP-…) to follow and escalate it. Deadline: the one shown above, counted from delivery; if the order doesn’t arrive, from the estimated delivery date.

Evidence we accept: photos or video of the item and packaging, screenshots of the listing, the tracking number and your messages with the store.

How we decide: we compare the item received with the listing, the carrier’s tracking and both parties’ evidence. The store has 3 business days to answer; if it doesn’t, we decide with the evidence available. If the problem is the store’s (damaged, different, incomplete or not as described), the store pays the return label. The refund covers the price of the products and their taxes; the original shipping follows the “Original shipping” rule of the Return policy. A refund never exceeds what you paid for the order.

Payments: card payments are processed by Stripe; depending on the order, PayPal or bank transfer may also be available. NEXOVAX collects the order and holds the store’s share: the store only gets its money after delivery and the hold period shown above, and never while a return or dispute is open. Store payouts are approved manually and only to a verified payout account.

Refunds: they go back to the payment method used. Depending on your bank, they can take 5 to 10 business days to appear.

Chargebacks: if you open a dispute with your bank or card issuer, we handle it with the payment processor using the order’s evidence. Write to us first: it’s usually faster.

Identified and verified stores: when signing up, every store declares its name or legal name, entity type, country, tax ID, address and phone, and can start selling right away. We manually verify its payout account before paying it. The “Verified store” badge appears once our team has reviewed the tax details the store declared; we don’t check identity documents.

Lost, damaged or untracked parcels: if tracking shows no movement for 10 business days, the tracking number isn’t valid or the carrier confirms loss or damage, we treat it as an order not received and refund you if the store doesn’t replace it. Parcels held at customs follow the Terms and conditions.

If NEXOVAX stopped operating: we would give notice in advance, orders not yet shipped would be refunded and the money for delivered orders would be paid to each store.$t$),
    'fr', jsonb_build_array('Protection de l’acheteur et paiements', $t$Ce qui est couvert : si une commande n’arrive pas, arrive endommagée, n’est pas le bon produit ou ne correspond pas à la description, NEXOVAX vous aide à régler le problème et, le cas échéant, vous rembourse.

Comment réclamer : ouvrez la commande dans Mon compte → Commandes et demandez un retour ou écrivez à la boutique. À défaut de solution, utilisez Aide → Signaler un problème avec le numéro de commande. Chaque signalement reçoit un numéro de dossier (NX-REP-…) pour le suivre et le faire remonter. Délai : celui indiqué ci-dessus, à compter de la livraison ; si la commande n’arrive pas, à compter de la date de livraison estimée.

Preuves acceptées : photos ou vidéo du produit et de l’emballage, captures de l’annonce, numéro de suivi et messages échangés avec la boutique.

Comment nous décidons : nous comparons le produit reçu à l’annonce, le suivi du transporteur et les preuves des deux parties. La boutique dispose de 3 jours ouvrés pour répondre ; sans réponse, nous décidons avec les preuves disponibles. Si le problème vient de la boutique (endommagé, différent, incomplet ou non conforme), la boutique paie l’étiquette de retour. Le remboursement couvre le prix des produits et leurs taxes ; la livraison d’origine suit la règle « Livraison d’origine » de la Politique de retour. Le remboursement ne dépasse jamais ce que vous avez payé pour la commande.

Paiements : les paiements par carte sont traités par Stripe ; selon la commande, PayPal ou le virement bancaire peuvent aussi être proposés. NEXOVAX encaisse la commande et conserve la part de la boutique : la boutique ne reçoit son argent qu’après la livraison et la période de rétention indiquée ci-dessus, et jamais tant qu’un retour ou un litige est ouvert. Les retraits des boutiques sont approuvés manuellement et uniquement vers un compte de versement vérifié.

Remboursements : ils sont effectués sur le moyen de paiement utilisé. Selon votre banque, ils peuvent mettre de 5 à 10 jours ouvrés à apparaître.

Rétrofacturations : si vous ouvrez un litige auprès de votre banque ou de l’émetteur de votre carte, nous le traitons auprès du prestataire de paiement avec les preuves de la commande. Écrivez-nous d’abord : c’est généralement plus rapide.

Boutiques identifiées et vérifiées : à l’inscription, chaque boutique déclare son nom ou sa raison sociale, son type d’entité, son pays, son identifiant fiscal, son adresse et son téléphone, et peut vendre immédiatement. Nous vérifions manuellement son compte de versement avant de la payer. Le badge « Boutique vérifiée » apparaît lorsque notre équipe a examiné les informations fiscales déclarées par la boutique ; nous ne contrôlons pas de pièces d’identité.

Colis perdus, endommagés ou sans suivi : si le suivi n’indique aucun mouvement pendant 10 jours ouvrés, si le numéro de suivi n’est pas valable ou si le transporteur confirme la perte ou le dommage, nous le traitons comme une commande non reçue et vous remboursons si la boutique ne la remplace pas. Les colis retenus en douane suivent les Conditions générales.

Si NEXOVAX cessait son activité : nous vous préviendrions à l’avance, les commandes non encore expédiées seraient remboursées et l’argent des commandes livrées serait versé à chaque boutique.$t$),
    'ht', jsonb_build_array('Pwoteksyon achtè ak peman', $t$Sa sa kouvri: si yon kòmand pa rive, li rive kase, se pa bon pwodwi a oswa li pa sanble ak deskripsyon an, NEXOVAX ede w rezoud sa epi, lè sa aplike, li remèt ou lajan w.

Kijan pou fè reklamasyon: louvri kòmand lan nan Kont mwen → Kòmand epi mande yon retou oswa ekri boutik la. Si sa pa rezoud pwoblèm nan, sèvi ak Èd → Rapòte yon pwoblèm ak nimewo kòmand lan. Chak rapò resevwa yon nimewo dosye (NX-REP-…) pou swiv li epi fè l monte pi wo. Delè: sa ki endike anlè a, apati livrezon an; si kòmand lan pa rive, apati dat livrezon yo te estime a.

Prèv nou aksepte: foto oswa videyo pwodwi a ak anbalaj la, kaptire piblikasyon an, nimewo swivi a ak mesaj ou te voye boutik la.

Kijan nou deside: nou konpare pwodwi ou resevwa a ak piblikasyon an, swivi transpòtè a ak prèv de pati yo. Boutik la gen 3 jou ouvrab pou reponn; si li pa reponn, nou deside ak prèv ki disponib yo. Si pwoblèm nan se pou boutik la (kase, diferan, pa konplè oswa pa sanble ak deskripsyon an), boutik la peye etikèt retou a. Ranbousman an kouvri pri pwodwi yo ak taks yo; livrezon orijinal la swiv règ « Livrezon orijinal » nan Politik retou a. Ranbousman an pa janm depase sa w te peye pou kòmand lan.

Peman: se Stripe ki trete peman ak kat; selon kòmand lan, PayPal oswa transfè bankè ka disponib tou. NEXOVAX touche kòmand lan epi kenbe pati boutik la: boutik la resevwa lajan l sèlman apre livrezon an ak peryòd retansyon ki endike anlè a, epi janm pandan gen yon retou oswa yon diskisyon ouvè. Retrè boutik yo apwouve alamen epi sèlman sou yon kont peman ki verifye.

Ranbousman: yo fèt sou menm mwayen peman ou te itilize a. Selon bank ou, yo ka pran 5 a 10 jou ouvrab pou parèt.

Kontestasyon bankè (chargeback): si w louvri yon diskisyon ak bank ou oswa konpayi kat ou, nou jere l ak sèvis peman an avèk prèv kòmand lan. Ekri nou anvan: li pi rapid an jeneral.

Boutik idantifye ak verifye: lè yon boutik enskri, li deklare non l oswa non legal li, kalite antite a, peyi l, idantifyan fiskal li, adrès li ak telefòn li, epi li ka kòmanse vann touswit. Nou verifye kont peman l alamen anvan nou peye l. Badj « Boutik verifye » parèt lè ekip nou an fin revize enfòmasyon fiskal boutik la te deklare yo; nou pa verifye dokiman idantite.

Pake pèdi, kase oswa san swivi: si swivi a pa montre okenn mouvman pandan 10 jou ouvrab, nimewo swivi a pa valab oswa transpòtè a konfime pèt la oswa domaj la, nou konsidere li kòm yon kòmand ki pa rive epi nou ranbouse w si boutik la pa ranplase l. Pake ladwàn kenbe yo swiv sa Tèm ak kondisyon yo di.

Si NEXOVAX ta sispann fonksyone: nou ta avèti davans, kòmand ki poko voye yo ta ranbouse epi lajan kòmand ki livre yo ta peye bay chak boutik.$t$))),

  -- ------------------------------------------------------------------------------------------ ABOUT_US
  ('ABOUT_US', false, jsonb_build_object(
    'es', jsonb_build_array('Sobre nosotros', $t$NEXOVAX es un marketplace internacional: reúne en un solo lugar a tiendas de distintos países y a compradores de todo el mundo, con un único carrito, pagos protegidos y envíos con seguimiento.

Cómo funciona: cada tienda publica sus productos, fija sus precios y prepara y envía sus propios pedidos. NEXOVAX opera la plataforma: procesa los pagos (tarjeta con Stripe y, cuando están habilitados, PayPal y transferencia bancaria), calcula el envío y los impuestos antes de que pagues y retiene el dinero de la tienda hasta después de la entrega y de un período de retención, nunca mientras haya una devolución o un reclamo abierto.

Tiendas: cada tienda se registra con su país, su identificación fiscal y la dirección desde donde despacha, y puede vender desde ese momento. Verificamos su cuenta de cobro antes de pagarle, y la insignia «Tienda verificada» indica que nuestro equipo revisó sus datos fiscales. Las reseñas de los compradores son públicas.

Compradores: todas las tiendas siguen la misma política de devoluciones y la misma política de envíos. Si un pedido no llega o no coincide con lo descrito, nuestro equipo interviene.

Idiomas: el sitio y la atención están disponibles en español, inglés, francés y criollo haitiano.

Contacto: escríbenos desde Ayuda → Contactar a soporte (no necesitas una cuenta) o al correo de soporte que aparece abajo. Los datos legales de la empresa se muestran al final de esta página.$t$),
    'en', jsonb_build_array('About us', $t$NEXOVAX is an international marketplace: it brings together stores from different countries and buyers from around the world, with a single cart, protected payments and tracked shipping.

How it works: each store lists its products, sets its prices and prepares and ships its own orders. NEXOVAX runs the platform: it processes payments (cards through Stripe and, when enabled, PayPal and bank transfer), calculates shipping and taxes before you pay and holds the store’s money until after delivery and a holding period, never while a return or claim is open.

Stores: each store registers with its country, tax ID and the address it ships from, and can sell right away. We verify its payout account before paying it, and the “Verified store” badge means our team reviewed its tax details. Buyer reviews are public.

Buyers: every store follows the same return policy and the same shipping policy. If an order doesn’t arrive or isn’t as described, our team steps in.

Languages: the site and support are available in Spanish, English, French and Haitian Creole.

Contact: write to us from Help → Contact support (no account needed) or at the support e-mail shown below. The company’s legal details are at the bottom of this page.$t$),
    'fr', jsonb_build_array('À propos', $t$NEXOVAX est une marketplace internationale : elle réunit en un seul lieu des boutiques de différents pays et des acheteurs du monde entier, avec un panier unique, des paiements protégés et des envois suivis.

Fonctionnement : chaque boutique publie ses produits, fixe ses prix et prépare et expédie ses propres commandes. NEXOVAX exploite la plateforme : elle traite les paiements (carte via Stripe et, lorsqu’ils sont activés, PayPal et virement bancaire), calcule la livraison et les taxes avant votre paiement et conserve l’argent de la boutique jusqu’après la livraison et une période de rétention, jamais tant qu’un retour ou une réclamation est ouvert.

Boutiques : chaque boutique s’inscrit avec son pays, son identifiant fiscal et son adresse d’expédition, et peut vendre immédiatement. Nous vérifions son compte de versement avant de la payer, et le badge « Boutique vérifiée » indique que notre équipe a examiné ses informations fiscales. Les avis des acheteurs sont publics.

Acheteurs : toutes les boutiques suivent la même politique de retour et la même politique d’expédition. Si une commande n’arrive pas ou ne correspond pas à la description, notre équipe intervient.

Langues : le site et l’assistance sont disponibles en espagnol, anglais, français et créole haïtien.

Contact : écrivez-nous depuis Aide → Contacter le support (sans compte) ou à l’adresse e-mail du support indiquée ci-dessous. Les informations légales de l’entreprise figurent en bas de cette page.$t$),
    'ht', jsonb_build_array('Konsènan nou', $t$NEXOVAX se yon marketplace entènasyonal: li rasanble nan yon sèl kote boutik ki soti nan plizyè peyi ak achtè toupatou sou latè, ak yon sèl panye, peman ki pwoteje ak livrezon ki gen swivi.

Kijan sa mache: chak boutik pibliye pwodwi li, fikse pri li epi li prepare ak voye pwòp kòmand li. NEXOVAX jere platfòm nan: li trete peman yo (kat ak Stripe epi, lè yo aktive, PayPal ak transfè labank), li kalkile livrezon ak taks anvan ou peye epi li kenbe lajan boutik la jiskaske apre livrezon an ak yon peryòd retansyon, janm pandan gen yon retou oswa yon reklamasyon ki louvri.

Boutik: chak boutik enskri ak peyi l, idantifyan fiskal li ak adrès kote l voye pwodwi yo, epi li ka vann touswit. Nou verifye kont peman l anvan nou peye l, epi badj « Boutik verifye » vle di ekip nou an revize enfòmasyon fiskal li. Avi achtè yo piblik.

Achtè: tout boutik yo swiv menm politik retou a ak menm politik livrezon an. Si yon kòmand pa rive oswa li pa sanble ak deskripsyon an, ekip nou an entèvni.

Lang: sit la ak sipò a disponib an panyòl, anglè, franse ak kreyòl ayisyen.

Kontak: ekri nou depi Èd → Kontakte sipò (ou pa bezwen kont) oswa nan imèl sipò ki parèt anba a. Enfòmasyon legal konpayi an parèt anba paj sa a.$t$))),

  -- ------------------------------------------------------------------------------------------ SELLER_TERMS
  ('SELLER_TERMS', true, jsonb_build_object(
    'es', jsonb_build_array('Términos para vendedores', $t$Al vender en NEXOVAX aceptas lo siguiente:

Publicaciones: publicar solo productos legales, propios o autorizados, con descripciones, fotos, precios e inventario veraces, y cumplir las políticas de contenido del marketplace. Tus productos aparecen al publicarlos, salvo que la administración active la revisión previa; NEXOVAX puede ocultar o retirar publicaciones que incumplan.

Datos de la tienda: declarar datos fiscales verdaderos (razón social, país e identificación fiscal) y mantenerlos al día; aparecen en los recibos de tus ventas. La insignia «Tienda verificada» se muestra cuando nuestro equipo los revisa.

Pedidos: despachar a tiempo los pedidos pagados y registrar su seguimiento.

Devoluciones: aplicar la política de devoluciones única de NEXOVAX (las tiendas no fijan una propia), revisar las solicitudes e inspeccionar los productos devueltos. Cuando la devolución se debe a un problema de tu tienda (producto dañado, distinto, incompleto o que no coincide con lo descrito), pagas la etiqueta de devolución y el reembolso; NEXOVAX descuenta esos importes de tu saldo o de tus fondos pendientes y, si no alcanzan, quedas debiendo la diferencia.

Comisión: la comisión por venta vigente del marketplace sobre el precio del producto (sin envío ni impuestos), que se descuenta de cada venta.

Fondos y retiros: tus fondos pasan a tu saldo disponible después de la entrega y del período de retención vigente, nunca mientras haya una devolución, disputa o contracargo abierto, y pueden retenerse o descontarse para cubrir reembolsos, contracargos o incidencias de pago. Los retiros se aprueban manualmente y solo a una cuenta de cobro verificada.

Incumplimiento: si no cumples estas obligaciones, NEXOVAX puede retener tus pagos o suspender tu tienda, después de avisarte y darte la oportunidad de responder.$t$),
    'en', jsonb_build_array('Seller terms', $t$By selling on NEXOVAX you agree to the following:

Listings: list only legal products that are yours or that you are authorized to sell, with truthful descriptions, photos, prices and stock, and follow the marketplace content policies. Your products appear when you publish them unless the administration turns on prior review; NEXOVAX may hide or remove listings that don’t comply.

Store details: declare true tax details (legal name, country and tax ID) and keep them up to date; they appear on the receipts of your sales. The “Verified store” badge is shown once our team reviews them.

Orders: ship paid orders on time and record their tracking.

Returns: apply the single NEXOVAX return policy (stores don’t set their own), review requests and inspect returned items. When a return is due to your store’s problem (damaged, different, incomplete or not as described), you pay the return label and the refund; NEXOVAX deducts those amounts from your balance or pending funds and, if they aren’t enough, you owe the difference.

Commission: the marketplace’s current commission per sale on the product price (excluding shipping and taxes), deducted from each sale.

Funds and payouts: your funds move to your available balance after delivery and the current holding period, never while a return, dispute or chargeback is open, and may be held or deducted to cover refunds, chargebacks or payment issues. Payouts are approved manually and only to a verified payout account.

Non-compliance: if you don’t meet these obligations, NEXOVAX may hold your payouts or suspend your store, after notifying you and giving you a chance to respond.$t$),
    'fr', jsonb_build_array('Conditions vendeurs', $t$En vendant sur NEXOVAX, vous acceptez ce qui suit :

Annonces : ne publier que des produits légaux, vous appartenant ou que vous êtes autorisé à vendre, avec des descriptions, photos, prix et stocks exacts, et respecter les règles de contenu de la marketplace. Vos produits apparaissent dès leur publication, sauf si l’administration active la révision préalable ; NEXOVAX peut masquer ou retirer les annonces non conformes.

Informations de la boutique : déclarer des informations fiscales exactes (raison sociale, pays et identifiant fiscal) et les tenir à jour ; elles figurent sur les reçus de vos ventes. Le badge « Boutique vérifiée » s’affiche une fois qu’elles ont été examinées par notre équipe.

Commandes : expédier à temps les commandes payées et enregistrer leur suivi.

Retours : appliquer la politique de retour unique de NEXOVAX (les boutiques ne fixent pas la leur), examiner les demandes et inspecter les produits retournés. Lorsqu’un retour est dû à un problème de votre boutique (produit endommagé, différent, incomplet ou non conforme), vous payez l’étiquette de retour et le remboursement ; NEXOVAX déduit ces montants de votre solde ou de vos fonds en attente et, s’ils ne suffisent pas, vous restez redevable de la différence.

Commission : la commission par vente en vigueur de la marketplace sur le prix du produit (hors livraison et taxes), déduite de chaque vente.

Fonds et versements : vos fonds passent à votre solde disponible après la livraison et la période de rétention en vigueur, jamais tant qu’un retour, un litige ou une rétrofacturation est ouvert, et peuvent être retenus ou déduits pour couvrir des remboursements, rétrofacturations ou incidents de paiement. Les versements sont approuvés manuellement et uniquement vers un compte de versement vérifié.

Manquements : si vous ne respectez pas ces obligations, NEXOVAX peut retenir vos versements ou suspendre votre boutique, après vous avoir prévenu et vous avoir permis de répondre.$t$),
    'ht', jsonb_build_array('Kondisyon pou machann', $t$Lè w vann sou NEXOVAX ou dakò ak sa ki swiv yo:

Piblikasyon: pibliye sèlman pwodwi ki legal, ki pou ou oswa ou gen otorizasyon pou vann, ak deskripsyon, foto, pri ak stòk ki vre, epi respekte règ kontni marketplace la. Pwodwi ou yo parèt lè w pibliye yo, sof si administrasyon an aktive revizyon davans; NEXOVAX ka kache oswa retire piblikasyon ki pa respekte règ yo.

Enfòmasyon boutik la: deklare enfòmasyon fiskal ki vre (non legal, peyi ak idantifyan fiskal) epi kenbe yo ajou; yo parèt sou resi vant ou yo. Badj « Boutik verifye » parèt lè ekip nou an fin revize yo.

Kòmand: voye kòmand ki peye yo atan epi anrejistre swivi yo.

Retou: aplike sèl politik retou NEXOVAX la (boutik yo pa fikse pa yo), revize demann yo epi enspekte pwodwi ki retounen yo. Lè yon retou fèt akoz yon pwoblèm boutik ou (pwodwi kase, diferan, pa konplè oswa ki pa sanble ak deskripsyon an), ou peye etikèt retou a ak ranbousman an; NEXOVAX retire montan sa yo nan balans ou oswa nan lajan ou ki an atant epi, si sa pa ase, ou rete dwe diferans lan.

Komisyon: komisyon marketplace la ki an vigè sou chak vant, sou pri pwodwi a (san livrezon ni taks), yo retire l nan chak vant.

Lajan ak retrè: lajan w pase nan balans disponib ou apre livrezon an ak peryòd retansyon ki an vigè a, janm pandan gen yon retou, yon diskisyon oswa yon chargeback ki louvri, epi yo ka kenbe l oswa retire l pou kouvri ranbousman, chargeback oswa pwoblèm peman. Retrè yo apwouve alamen epi sèlman sou yon kont peman ki verifye.

Si w pa respekte yo: si w pa respekte obligasyon sa yo, NEXOVAX ka kenbe peman w oswa sispann boutik ou, apre li fin avèti w epi ba w chans pou w reponn.$t$)))

  ) as x(code, reaccept, loc) loop
    select id into v_policy from public.policies where code = p.code;
    continue when v_policy is null;
    continue when exists (select 1 from public.policy_versions v join public.policy_version_localizations l on l.policy_version_id = v.id and l.locale = 'es'
                           where v.policy_id = v_policy and l.content->>'text' = p.loc->'es'->>1);
    select coalesce(max(version_number), 0) + 1 into v_next from public.policy_versions where policy_id = v_policy;
    insert into public.policy_versions (policy_id, version_number, requires_reacceptance, created_by_user_id) values (v_policy, v_next, p.reaccept, v_admin) returning id into v_version;
    insert into public.policy_version_localizations (policy_version_id, locale, title, content_format, content)
    select v_version, l.key, l.value->>0, 'PLAIN_TEXT', jsonb_build_object('text', l.value->>1) from jsonb_each(p.loc) l;
    perform public.publish_policy_version(v_version, v_admin, now());
  end loop;
end $$;

-- ------------------------------------------------------------------------------------------ help center
-- Only the return answer of the FAQ and the «Devoluciones» section of the seller guide are replaced; the
-- other items keep whatever the admin saved. A new setting version is activated (history kept).
CREATE OR REPLACE FUNCTION pg_temp.nx_set(p_key text, p_value jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_current jsonb; v_id uuid; v_actor uuid;
BEGIN
  SELECT value INTO v_current FROM public.system_setting_values
   WHERE setting_key = p_key AND scope_type = 'GLOBAL' AND status = 'ACTIVE'
   ORDER BY version_number DESC LIMIT 1;
  IF v_current IS NOT DISTINCT FROM p_value THEN RETURN; END IF;
  SELECT u.id INTO v_actor FROM public.users u
    JOIN public.user_roles ur ON ur.user_id = u.id JOIN public.roles r ON r.id = ur.role_id
   WHERE r.code IN ('SUPER_ADMIN', 'ADMIN') ORDER BY u.created_at LIMIT 1;
  INSERT INTO public.system_setting_values (setting_key, version_number, scope_type, value, checksum, status, created_by_user_id)
  VALUES (p_key, COALESCE((SELECT max(version_number) FROM public.system_setting_values WHERE setting_key = p_key), 0) + 1,
          'GLOBAL', p_value, extensions.digest(p_value::text, 'sha256'), 'DRAFT', v_actor)
  RETURNING id INTO v_id;
  IF v_actor IS NOT NULL THEN
    PERFORM public.activate_system_setting_value(v_id, v_actor, now());
  ELSE
    UPDATE public.system_setting_values SET status = 'SUPERSEDED', superseded_at = now()
     WHERE setting_key = p_key AND scope_type = 'GLOBAL' AND status = 'ACTIVE';
    UPDATE public.system_setting_values SET status = 'ACTIVE', effective_at = now(), activated_at = now() WHERE id = v_id;
    INSERT INTO public.system_setting_history (setting_value_id, event_type, reason) VALUES (v_id, 'ACTIVATED', 'Centro de ayuda alineado con las políticas legales');
  END IF;
END $$;

DO $$
DECLARE
  faq_return jsonb := jsonb_build_object(
    'q', '¿Puedo devolver un producto?',
    'qEn', 'Can I return a product?',
    'qFr', 'Puis-je retourner un produit ?',
    'qHt', 'Èske m ka retounen yon pwodwi?',
    'a', $t$Sí. Todas las tiendas siguen la misma política de NEXOVAX. Solicita la devolución desde Mi cuenta → Pedidos dentro del plazo que ves arriba, en «Devoluciones», contado desde la entrega. Si el producto llegó dañado, es distinto, está incompleto o no coincide con la descripción, la tienda paga la etiqueta de devolución. Si te equivocaste de talla, color o modelo o cambiaste de opinión, lo envías por correo y pagas el envío de vuelta. No hay cargo por reposición. Cuando la tienda recibe e inspecciona el producto, reembolsamos el producto y sus impuestos al método de pago original; el envío original no se reembolsa. No hacemos cambios: para otra talla o color, devuélvelo y haz un nuevo pedido. Detalles en la Política de devoluciones.$t$,
    'aEn', $t$Yes. Every store follows the same NEXOVAX policy. Request the return from My account → Orders within the window shown above under “Returns”, counted from delivery. If the item arrived damaged, is different, incomplete or not as described, the store pays the return label. If you picked the wrong size, color or model or changed your mind, you mail it back and pay the return shipping. There is no restocking fee. Once the store receives and inspects the item, we refund the item and its taxes to the original payment method; the original shipping isn’t refunded. We don’t do exchanges: for another size or color, return it and place a new order. Details in the Return policy.$t$,
    'aFr', $t$Oui. Toutes les boutiques suivent la même politique NEXOVAX. Demandez le retour depuis Mon compte → Commandes dans le délai indiqué ci-dessus, dans « Retours », à compter de la livraison. Si le produit est arrivé endommagé, est différent, incomplet ou non conforme, la boutique paie l’étiquette de retour. Si vous vous êtes trompé de taille, de couleur ou de modèle ou avez changé d’avis, vous le renvoyez par la poste et payez le retour. Aucuns frais de remise en stock. Une fois le produit reçu et inspecté par la boutique, nous remboursons le produit et ses taxes sur le moyen de paiement d’origine ; la livraison d’origine n’est pas remboursée. Pas d’échanges : pour une autre taille ou couleur, retournez-le et passez une nouvelle commande. Détails dans la Politique de retour.$t$,
    'aHt', $t$Wi. Tout boutik yo swiv menm politik NEXOVAX la. Mande retou a depi Kont mwen → Kòmand nan delè ki parèt anlè a, nan « Retou », apati livrezon an. Si pwodwi a rive kase, li diferan, li pa konplè oswa li pa sanble ak deskripsyon an, boutik la peye etikèt retou a. Si w te chwazi move gwosè, koulè oswa modèl oswa ou chanje lide, ou voye l pa lapòs epi ou peye livrezon retou a. Pa gen frè pou remete an stòk. Lè boutik la resevwa epi enspekte pwodwi a, nou ranbouse pwodwi a ak taks li sou menm mwayen peman an; livrezon orijinal la pa ranbouse. Nou pa fè echanj: pou yon lòt gwosè oswa koulè, retounen l epi fè yon nouvo kòmand. Detay yo nan Politik retou a.$t$);
  seller_returns jsonb := jsonb_build_object(
    'title', 'Devoluciones', 'titleEn', 'Returns', 'titleFr', 'Retours', 'titleHt', 'Retou',
    'body', $t$Todas las tiendas usan la política de devoluciones de NEXOVAX; no puedes fijar una propia. Revisa las solicitudes, recibe e inspecciona el producto y después se emite el reembolso. Si la devolución se debe a un problema de tu tienda (dañado, distinto, incompleto o no coincide con lo descrito), la etiqueta de devolución y el reembolso se descuentan de tu saldo; si fue un error o un cambio de opinión del cliente, el cliente paga el envío de vuelta. Sin cargo por reposición y sin cambios.$t$,
    'bodyEn', $t$Every store uses the NEXOVAX return policy; you can’t set your own. Review the requests, receive and inspect the item, and the refund is then issued. If the return is due to your store’s problem (damaged, different, incomplete or not as described), the return label and the refund are deducted from your balance; if it was the customer’s mistake or change of mind, the customer pays the return shipping. No restocking fee and no exchanges.$t$,
    'bodyFr', $t$Toutes les boutiques appliquent la politique de retour de NEXOVAX ; vous ne pouvez pas fixer la vôtre. Examinez les demandes, recevez et inspectez le produit, puis le remboursement est émis. Si le retour est dû à un problème de votre boutique (endommagé, différent, incomplet ou non conforme), l’étiquette de retour et le remboursement sont déduits de votre solde ; s’il s’agit d’une erreur ou d’un changement d’avis du client, le client paie le retour. Sans frais de remise en stock ni échange.$t$,
    'bodyHt', $t$Tout boutik yo itilize politik retou NEXOVAX la; ou pa ka fikse pa w. Revize demann yo, resevwa epi enspekte pwodwi a, apre sa ranbousman an fèt. Si retou a fèt akoz yon pwoblèm boutik ou (kase, diferan, pa konplè oswa pa sanble ak deskripsyon an), yo retire etikèt retou a ak ranbousman an nan balans ou; si se te yon erè oswa yon chanjman lide kliyan an, se kliyan an ki peye livrezon retou a. San frè remete an stòk e san echanj.$t$);
  v_faq jsonb; v_sellers jsonb;
BEGIN
  SELECT value INTO v_faq FROM public.system_setting_values WHERE setting_key = 'help.faq' AND scope_type = 'GLOBAL' AND status = 'ACTIVE' ORDER BY version_number DESC LIMIT 1;
  IF jsonb_typeof(v_faq) = 'array' THEN
    SELECT jsonb_agg(CASE WHEN e->>'q' = faq_return->>'q' OR e->>'qEn' = faq_return->>'qEn' THEN faq_return ELSE e END ORDER BY i)
      INTO v_faq FROM jsonb_array_elements(v_faq) WITH ORDINALITY AS t(e, i);
    PERFORM pg_temp.nx_set('help.faq', v_faq);
  END IF;
  SELECT value INTO v_sellers FROM public.system_setting_values WHERE setting_key = 'help.sellers' AND scope_type = 'GLOBAL' AND status = 'ACTIVE' ORDER BY version_number DESC LIMIT 1;
  IF jsonb_typeof(v_sellers->'sections') = 'array' THEN
    SELECT jsonb_set(v_sellers, '{sections}', jsonb_agg(CASE WHEN e->>'title' = 'Devoluciones' OR e->>'titleEn' = 'Returns' THEN seller_returns ELSE e END ORDER BY i))
      INTO v_sellers FROM jsonb_array_elements(v_sellers->'sections') WITH ORDINALITY AS t(e, i);
    PERFORM pg_temp.nx_set('help.sellers', v_sellers);
  END IF;
END $$;
