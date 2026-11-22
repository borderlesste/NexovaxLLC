-- NEXOVAX: Terms v2 and Privacy v2 (legal entity, governing law, customs holds, data controller).
--
--  * Operator confirmed by the owner on 2026-11-22: NEXOVAX LLC, organized in Pennsylvania (USA),
--    based in Harrisburg, Pennsylvania.
--  * Terms v2 adds: who operates the site, customs and import duties, what happens when a parcel is
--    held at customs, buyer–store disputes, governing law and jurisdiction.
--  * Privacy v2 adds: the data controller, the providers that process data, cookies and rights.
--  * Both are published without re-acceptance (they clarify, they don't add obligations to accept);
--    the admin can still publish later versions in Admin → Ajustes → Políticas legales.

do $$
declare
  p record; v_policy uuid; v_version uuid; v_next int; v_admin uuid;
begin
  select ur.user_id into v_admin from public.user_roles ur join public.roles r on r.id = ur.role_id join public.users u on u.id = ur.user_id
   where r.code = 'SUPER_ADMIN' and ur.revoked_at is null and u.status = 'ACTIVE' order by u.created_at limit 1;
  for p in select * from (values
    ('TERMS_OF_SERVICE', jsonb_build_object(
      'es', jsonb_build_array('Términos y condiciones', $t$Quién opera NEXOVAX: el sitio nexovax.com es operado por NEXOVAX LLC, sociedad de responsabilidad limitada constituida en el Estado de Pensilvania (Estados Unidos), con domicilio en Harrisburg, Pensilvania. NEXOVAX es un marketplace: cada compra es un contrato entre el comprador y la tienda que vende el producto; NEXOVAX opera la plataforma, procesa los pagos y presta el soporte.

Uso del marketplace: al usar NEXOVAX aceptas comprar y vender de buena fe, cumplir las leyes aplicables en tu país y en el país de destino de cada envío, y las políticas de contenido del marketplace.

Responsabilidad de las tiendas: los vendedores son responsables de la veracidad de sus publicaciones, precios e inventario, del despacho de sus pedidos y del cumplimiento aduanero de sus envíos internacionales: deben declarar el contenido y el valor reales del paquete y adjuntar la documentación que exija el destino.

Aduanas e impuestos de importación: en los envíos internacionales el comprador es el importador. Los impuestos y aranceles que cobre el país de destino corren por su cuenta, salvo que el checkout indique que ya están incluidos.

Paquetes retenidos en aduana: avísanos desde Ayuda → Contactar a soporte con el número de pedido. (1) La tienda debe aportar en un plazo de 5 días hábiles la documentación que pida la aduana. (2) El comprador debe atender los requerimientos que la aduana le haga como importador y pagar los cargos que le correspondan. (3) Si el paquete es devuelto o destruido por causa de la tienda (documentación incompleta, declaración incorrecta o producto no permitido en el destino), el comprador recibe el reembolso total. Si se debe a que el comprador no atendió los requerimientos o no pagó los cargos de importación, el reembolso no incluye el envío ni esos cargos. (4) Si en 30 días desde el aviso no hay solución, NEXOVAX revisa las pruebas de ambas partes y decide sobre el reembolso con los fondos del pedido.

Disputas entre comprador y tienda: primero se intentan resolver por la mensajería del pedido. Si no hay acuerdo, cualquiera de las partes puede pedir la intervención de NEXOVAX desde el pedido o desde Ayuda; nuestra decisión se aplica a los fondos del pedido. Esto no limita los derechos que te reconozca la ley de tu país ni los de tu banco o emisor de tarjeta.

Ley aplicable y jurisdicción: estos términos se rigen por las leyes del Estado de Pensilvania y las leyes federales aplicables de los Estados Unidos. Cualquier controversia con NEXOVAX LLC se someterá a los tribunales competentes de Pensilvania, sin perjuicio de las normas de protección al consumidor de tu país de residencia que no puedan renunciarse.

Contacto: Ayuda → Contactar a soporte o el correo de soporte que figura al pie de la página.$t$),
      'en', jsonb_build_array('Terms and conditions', $t$Who operates NEXOVAX: the nexovax.com site is operated by NEXOVAX LLC, a limited liability company organized in the State of Pennsylvania (United States), based in Harrisburg, Pennsylvania. NEXOVAX is a marketplace: each purchase is a contract between the buyer and the store selling the product; NEXOVAX runs the platform, processes payments and provides support.

Using the marketplace: by using NEXOVAX you agree to buy and sell in good faith, to comply with the laws that apply in your country and in the destination country of each shipment, and with the marketplace content policies.

Store responsibilities: sellers are responsible for the accuracy of their listings, prices and inventory, for shipping their orders and for customs compliance of their international shipments: they must declare the real contents and value of each parcel and include the documents the destination requires.

Customs and import duties: for international shipments the buyer is the importer. Taxes and duties charged by the destination country are paid by the buyer, unless checkout shows they are already included.

Parcels held at customs: tell us from Help → Contact support with the order number. (1) The store must provide, within 5 business days, the documents customs asks for. (2) The buyer must answer what customs requires from the importer and pay the charges that apply to them. (3) If the parcel is returned or destroyed because of the store (incomplete documents, wrong declaration or a product not allowed at the destination), the buyer gets a full refund. If it is because the buyer didn’t answer customs or didn’t pay the import charges, the refund excludes shipping and those charges. (4) If there is no solution within 30 days of the notice, NEXOVAX reviews both parties’ evidence and decides on the refund using the order funds.

Buyer–store disputes: they are first worked out through the order messages. If there is no agreement, either party can ask NEXOVAX to step in from the order or from Help; our decision applies to the order funds. This does not limit the rights your country’s law gives you, nor those of your bank or card issuer.

Governing law and jurisdiction: these terms are governed by the laws of the Commonwealth of Pennsylvania and the applicable federal laws of the United States. Any dispute with NEXOVAX LLC will be brought before the competent courts of Pennsylvania, without prejudice to the consumer protection rules of your country of residence that cannot be waived.

Contact: Help → Contact support or the support e-mail shown in the page footer.$t$),
      'fr', jsonb_build_array('Conditions générales', $t$Qui exploite NEXOVAX : le site nexovax.com est exploité par NEXOVAX LLC, société à responsabilité limitée constituée dans l’État de Pennsylvanie (États-Unis), dont le siège est à Harrisburg, Pennsylvanie. NEXOVAX est une marketplace : chaque achat est un contrat entre l’acheteur et la boutique qui vend le produit ; NEXOVAX exploite la plateforme, traite les paiements et assure le support.

Utilisation de la marketplace : en utilisant NEXOVAX, vous acceptez d’acheter et de vendre de bonne foi, de respecter les lois applicables dans votre pays et dans le pays de destination de chaque envoi, ainsi que les règles de contenu de la marketplace.

Responsabilité des boutiques : les vendeurs sont responsables de l’exactitude de leurs annonces, prix et stocks, de l’expédition de leurs commandes et de la conformité douanière de leurs envois internationaux : ils doivent déclarer le contenu et la valeur réels de chaque colis et joindre les documents exigés par le pays de destination.

Douane et droits d’importation : pour les envois internationaux, l’acheteur est l’importateur. Les taxes et droits perçus par le pays de destination sont à sa charge, sauf si le paiement indique qu’ils sont déjà inclus.

Colis retenus en douane : prévenez-nous depuis Aide → Contacter le support avec le numéro de commande. (1) La boutique doit fournir, sous 5 jours ouvrés, les documents demandés par la douane. (2) L’acheteur doit répondre aux demandes que la douane lui adresse en tant qu’importateur et payer les frais qui lui reviennent. (3) Si le colis est renvoyé ou détruit à cause de la boutique (documents incomplets, déclaration erronée ou produit interdit à destination), l’acheteur est remboursé intégralement. Si c’est parce que l’acheteur n’a pas répondu à la douane ou n’a pas payé les frais d’importation, le remboursement exclut la livraison et ces frais. (4) Sans solution dans les 30 jours suivant le signalement, NEXOVAX examine les preuves des deux parties et décide du remboursement avec les fonds de la commande.

Litiges entre acheteur et boutique : ils se règlent d’abord par la messagerie de la commande. À défaut d’accord, chaque partie peut demander l’intervention de NEXOVAX depuis la commande ou depuis Aide ; notre décision s’applique aux fonds de la commande. Cela ne limite pas les droits que vous accorde la loi de votre pays, ni ceux de votre banque ou de l’émetteur de votre carte.

Droit applicable et juridiction : les présentes conditions sont régies par les lois de l’État de Pennsylvanie et les lois fédérales applicables des États-Unis. Tout litige avec NEXOVAX LLC sera porté devant les tribunaux compétents de Pennsylvanie, sans préjudice des règles impératives de protection des consommateurs de votre pays de résidence.

Contact : Aide → Contacter le support ou l’adresse e-mail du support indiquée en bas de page.$t$),
      'ht', jsonb_build_array('Tèm ak kondisyon', $t$Kiyès ki opere NEXOVAX: se NEXOVAX LLC ki opere sit nexovax.com, yon sosyete responsablite limite ki konstitye nan Eta Pennsylvania (Etazini), ki baze Harrisburg, Pennsylvania. NEXOVAX se yon maketplas: chak acha se yon kontra ant achtè a ak boutik ki vann pwodwi a; NEXOVAX jere platfòm nan, li trete peman yo epi li bay sipò.

Itilizasyon maketplas la: lè w sèvi ak NEXOVAX, ou dakò pou achte ak vann ak bòn fwa, pou respekte lwa ki aplike nan peyi w ak nan peyi kote chak koli prale, ak règ kontni maketplas la.

Responsablite boutik yo: vandè yo responsab pou piblikasyon, pri ak stòk yo kòrèk, pou voye kòmand yo ak pou respekte règ ladwàn pou livrezon entènasyonal: yo dwe deklare vrè kontni ak vrè valè chak koli epi mete dokiman peyi destinasyon an mande yo.

Ladwàn ak taks enpòtasyon: pou livrezon entènasyonal, achtè a se enpòtatè a. Se li ki peye taks ak dwa peyi destinasyon an mande, sof si peman an montre yo deja enkli.

Koli ki bloke nan ladwàn: avèti nou nan Èd → Kontakte sipò ak nimewo kòmand lan. (1) Boutik la dwe bay dokiman ladwàn mande yo nan 5 jou travay. (2) Achtè a dwe reponn sa ladwàn mande l kòm enpòtatè epi peye frè ki pou li yo. (3) Si koli a retounen oswa yo detwi l akoz boutik la (dokiman ki pa konplè, move deklarasyon oswa pwodwi ki pa otorize nan destinasyon an), achtè a resevwa tout lajan li. Si se paske achtè a pa t reponn ladwàn oswa li pa t peye frè enpòtasyon yo, ranbousman an pa gen ladan l livrezon an ni frè sa yo. (4) Si pa gen solisyon nan 30 jou apre avètisman an, NEXOVAX egzamine prèv de pati yo epi li deside sou ranbousman an ak lajan kòmand lan.

Diskisyon ant achtè ak boutik: yo eseye rezoud yo anvan nan mesaj kòmand lan. Si pa gen antant, nenpòt pati ka mande NEXOVAX entèvni depi kòmand lan oswa depi Èd; desizyon nou aplike sou lajan kòmand lan. Sa pa limite dwa lwa peyi w ba ou, ni dwa bank ou oswa konpayi kat ou.

Lwa ki aplike ak jiridiksyon: tèm sa yo swiv lwa Eta Pennsylvania ak lwa federal Etazini ki aplike. Nenpòt diskisyon ak NEXOVAX LLC ap ale devan tribinal konpetan Pennsylvania, san sa pa retire règ pwoteksyon konsomatè peyi kote w rete a ki pa ka anile.

Kontak: Èd → Kontakte sipò oswa imèl sipò ki parèt anba paj la.$t$))),
    ('PRIVACY_POLICY', jsonb_build_object(
      'es', jsonb_build_array('Política de privacidad', $t$Responsable del tratamiento: NEXOVAX LLC, sociedad constituida en el Estado de Pensilvania (Estados Unidos), con domicilio en Harrisburg, Pensilvania, es responsable de los datos personales que se tratan en nexovax.com. Para cualquier consulta de privacidad escríbenos desde Ayuda → Contactar a soporte o al correo de soporte que figura al pie de la página.

Para qué usamos tus datos: únicamente para operar tu cuenta, procesar pedidos, pagos y envíos, y dar soporte. Compartimos con las transportadoras solo los datos necesarios para entregar tus pedidos y, con cada tienda, los datos del pedido que debe preparar y enviar.

Proveedores que tratan datos por cuenta nuestra: alojamiento y base de datos, procesadores de pago (Stripe y, si lo eliges, PayPal), servicios de envío y etiquetas (Shippo y las transportadoras), envío de correos (Resend), protección contra bots (Cloudflare Turnstile) y, solo si aceptas las cookies de analítica, Google Analytics.

Seguridad: los datos sensibles (identificación fiscal y cuentas bancarias de vendedores) se almacenan cifrados. No vendemos tus datos a terceros.

Cookies: usamos cookies esenciales para tu sesión y tus preferencias, y cookies de analítica solo con tu permiso. El detalle está en la sección Cookies del Centro de ayuda y puedes cambiar tu decisión en «Preferencias de cookies», al pie de la página.

Tus derechos: puedes consultar y corregir tus datos desde tu cuenta, pedirnos una copia, oponerte a usos no esenciales y solicitar la eliminación de tu cuenta. Conservamos los datos de pedidos y pagos el tiempo que exijan las obligaciones legales y fiscales.$t$),
      'en', jsonb_build_array('Privacy policy', $t$Data controller: NEXOVAX LLC, a company organized in the State of Pennsylvania (United States), based in Harrisburg, Pennsylvania, is responsible for the personal data processed on nexovax.com. For any privacy question, write to us from Help → Contact support or at the support e-mail shown in the page footer.

What we use your data for: only to run your account, process orders, payments and shipping, and provide support. We share with carriers only the data needed to deliver your orders and, with each store, the order details it needs to prepare and ship.

Providers that process data on our behalf: hosting and database, payment processors (Stripe and, if you choose it, PayPal), shipping and label services (Shippo and the carriers), e-mail delivery (Resend), bot protection (Cloudflare Turnstile) and, only if you accept analytics cookies, Google Analytics.

Security: sensitive data (sellers’ tax IDs and bank accounts) is stored encrypted. We don’t sell your data to third parties.

Cookies: we use essential cookies for your session and preferences, and analytics cookies only with your permission. Details are in the Cookies section of the Help center, and you can change your choice under “Cookie preferences” in the page footer.

Your rights: you can view and correct your data from your account, ask us for a copy, object to non-essential uses and request deletion of your account. We keep order and payment records for as long as legal and tax obligations require.$t$),
      'fr', jsonb_build_array('Politique de confidentialité', $t$Responsable du traitement : NEXOVAX LLC, société constituée dans l’État de Pennsylvanie (États-Unis), dont le siège est à Harrisburg, Pennsylvanie, est responsable des données personnelles traitées sur nexovax.com. Pour toute question de confidentialité, écrivez-nous depuis Aide → Contacter le support ou à l’adresse e-mail du support indiquée en bas de page.

Pourquoi nous utilisons vos données : uniquement pour gérer votre compte, traiter les commandes, les paiements et les livraisons, et assurer le support. Nous partageons avec les transporteurs uniquement les données nécessaires à la livraison et, avec chaque boutique, les données de la commande qu’elle doit préparer et expédier.

Prestataires qui traitent des données pour notre compte : hébergement et base de données, prestataires de paiement (Stripe et, si vous le choisissez, PayPal), services d’expédition et d’étiquettes (Shippo et les transporteurs), envoi d’e-mails (Resend), protection contre les robots (Cloudflare Turnstile) et, uniquement si vous acceptez les cookies d’analyse, Google Analytics.

Sécurité : les données sensibles (identifiants fiscaux et comptes bancaires des vendeurs) sont stockées chiffrées. Nous ne vendons pas vos données à des tiers.

Cookies : nous utilisons des cookies essentiels pour votre session et vos préférences, et des cookies d’analyse uniquement avec votre accord. Le détail se trouve dans la section Cookies du centre d’aide et vous pouvez modifier votre choix dans « Préférences de cookies », en bas de page.

Vos droits : vous pouvez consulter et corriger vos données depuis votre compte, en demander une copie, vous opposer aux usages non essentiels et demander la suppression de votre compte. Nous conservons les données de commandes et de paiements aussi longtemps que l’exigent les obligations légales et fiscales.$t$),
      'ht', jsonb_build_array('Règ sou konfidansyalite', $t$Responsab done yo: NEXOVAX LLC, yon sosyete ki konstitye nan Eta Pennsylvania (Etazini), ki baze Harrisburg, Pennsylvania, se responsab done pèsonèl yo trete sou nexovax.com. Pou nenpòt kesyon sou konfidansyalite, ekri nou nan Èd → Kontakte sipò oswa nan imèl sipò ki parèt anba paj la.

Poukisa nou sèvi ak done w: sèlman pou jere kont ou, trete kòmand, peman ak livrezon, epi bay sipò. Nou pataje ak transpòtè yo sèlman done ki nesesè pou livre kòmand ou yo epi, ak chak boutik, enfòmasyon kòmand li dwe prepare epi voye a.

Founisè ki trete done pou nou: ebèjman ak baz done, sèvis peman (Stripe epi, si w chwazi l, PayPal), sèvis livrezon ak etikèt (Shippo ak transpòtè yo), voye imèl (Resend), pwoteksyon kont robo (Cloudflare Turnstile) epi, sèlman si w aksepte bonbon analiz yo, Google Analytics.

Sekirite: done sansib yo (nimewo fiskal ak kont bankè vandè yo) estoke chifre. Nou pa vann done w bay lòt moun.

Bonbon (cookies): nou sèvi ak bonbon esansyèl pou sesyon w ak preferans ou, ak bonbon analiz sèlman avèk pèmisyon w. Detay yo nan seksyon Bonbon nan Sant èd la, epi ou ka chanje desizyon w nan «Preferans bonbon», anba paj la.

Dwa ou: ou ka wè epi korije done w nan kont ou, mande nou yon kopi, opoze ak itilizasyon ki pa esansyèl epi mande pou yo efase kont ou. Nou kenbe done kòmand ak peman yo pandan tan obligasyon legal ak fiskal yo mande.$t$)))
  ) as x(code, loc) loop
    select id into v_policy from public.policies where code = p.code;
    continue when v_policy is null;
    -- Idempotent: skip when a version with this exact Spanish text already exists.
    continue when exists (select 1 from public.policy_versions v join public.policy_version_localizations l on l.policy_version_id = v.id and l.locale = 'es'
                           where v.policy_id = v_policy and l.content->>'text' = p.loc->'es'->>1);
    select coalesce(max(version_number), 0) + 1 into v_next from public.policy_versions where policy_id = v_policy;
    insert into public.policy_versions (policy_id, version_number, requires_reacceptance, created_by_user_id) values (v_policy, v_next, false, v_admin) returning id into v_version;
    insert into public.policy_version_localizations (policy_version_id, locale, title, content_format, content)
    select v_version, l.key, l.value->>0, 'PLAIN_TEXT', jsonb_build_object('text', l.value->>1) from jsonb_each(p.loc) l;
    perform public.publish_policy_version(v_version, v_admin, now());
  end loop;
end $$;
