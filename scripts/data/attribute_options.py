"""
Option lists for product attributes (source of truth for the seed migration).

input:
  select   -> closed list: the seller must pick one of the options
  combobox -> open list: pick an option or type a new value (other sellers' values are suggested)
  text     -> free text (model numbers, ingredients, instructions…)

Each option: (value, Spanish label, English label). Values are stable codes stored in
product_attribute_values.value_text; labels are shown in the customer's language.

Run:  python3 scripts/data/attribute_options.py > supabase/migrations/<ts>_nexovax_attribute_options.sql
"""
import json
import sys

O = lambda *rows: [list(r) for r in rows]

SELECT, COMBO, TEXT = 'select', 'combobox', 'text'

ATTRS = {
    # ---------------------------------------------------------------- apparel
    'clothing_type': (SELECT, O(('tshirt', 'Camiseta', 'T-shirt'), ('shirt', 'Camisa', 'Shirt'), ('polo', 'Polo', 'Polo'), ('blouse', 'Blusa', 'Blouse'),
        ('sweater', 'Suéter', 'Sweater'), ('hoodie', 'Sudadera', 'Hoodie'), ('jacket', 'Chaqueta', 'Jacket'), ('coat', 'Abrigo', 'Coat'), ('vest', 'Chaleco', 'Vest'),
        ('dress', 'Vestido', 'Dress'), ('skirt', 'Falda', 'Skirt'), ('pants', 'Pantalón', 'Pants'), ('jeans', 'Jeans', 'Jeans'), ('shorts', 'Pantalón corto', 'Shorts'),
        ('leggings', 'Leggings', 'Leggings'), ('jumpsuit', 'Enterizo', 'Jumpsuit'), ('suit', 'Traje', 'Suit'), ('swimwear', 'Traje de baño', 'Swimwear'),
        ('underwear', 'Ropa interior', 'Underwear'), ('sleepwear', 'Pijama', 'Sleepwear'), ('activewear', 'Ropa deportiva', 'Activewear'), ('socks', 'Medias', 'Socks'))),
    'sleeve_length': (SELECT, O(('sleeveless', 'Sin mangas', 'Sleeveless'), ('cap', 'Manga casquillo', 'Cap sleeve'), ('short', 'Manga corta', 'Short sleeve'),
        ('three_quarter', 'Manga 3/4', '3/4 sleeve'), ('long', 'Manga larga', 'Long sleeve'))),
    'fit': (SELECT, O(('slim', 'Ajustado (slim)', 'Slim'), ('skinny', 'Pitillo (skinny)', 'Skinny'), ('regular', 'Regular', 'Regular'), ('tailored', 'Entallado', 'Tailored'),
        ('relaxed', 'Holgado', 'Relaxed'), ('loose', 'Suelto', 'Loose'), ('oversized', 'Oversize', 'Oversized'))),
    'pattern': (SELECT, O(('solid', 'Liso', 'Solid'), ('striped', 'Rayas', 'Striped'), ('plaid', 'Cuadros', 'Plaid'), ('floral', 'Floral', 'Floral'),
        ('polka_dot', 'Lunares', 'Polka dot'), ('animal_print', 'Animal print', 'Animal print'), ('camouflage', 'Camuflaje', 'Camouflage'), ('geometric', 'Geométrico', 'Geometric'),
        ('graphic', 'Estampado gráfico', 'Graphic print'), ('tie_dye', 'Tie-dye', 'Tie-dye'), ('abstract', 'Abstracto', 'Abstract'), ('logo', 'Con logo', 'Logo'))),
    'style': (COMBO, O(('casual', 'Casual', 'Casual'), ('formal', 'Formal', 'Formal'), ('sport', 'Deportivo', 'Sporty'), ('urban', 'Urbano', 'Streetwear'),
        ('classic', 'Clásico', 'Classic'), ('modern', 'Moderno', 'Modern'), ('vintage', 'Vintage', 'Vintage'), ('elegant', 'Elegante', 'Elegant'),
        ('bohemian', 'Bohemio', 'Bohemian'), ('minimalist', 'Minimalista', 'Minimalist'), ('rustic', 'Rústico', 'Rustic'), ('industrial', 'Industrial', 'Industrial'))),
    'occasion': (SELECT, O(('everyday', 'Uso diario', 'Everyday'), ('casual', 'Casual', 'Casual'), ('work', 'Trabajo', 'Work'), ('formal', 'Formal', 'Formal'),
        ('party', 'Fiesta', 'Party'), ('wedding', 'Boda', 'Wedding'), ('sport', 'Deporte', 'Sport'), ('beach', 'Playa', 'Beach'), ('travel', 'Viaje', 'Travel'))),
    'season': (SELECT, O(('all', 'Todas las estaciones', 'All seasons'), ('spring', 'Primavera', 'Spring'), ('summer', 'Verano', 'Summer'),
        ('autumn', 'Otoño', 'Autumn'), ('winter', 'Invierno', 'Winter'))),
    'closure_type': (SELECT, O(('zipper', 'Cremallera', 'Zipper'), ('buttons', 'Botones', 'Buttons'), ('snap', 'Broches', 'Snap'), ('hook_loop', 'Velcro', 'Hook and loop'),
        ('laces', 'Cordones', 'Laces'), ('buckle', 'Hebilla', 'Buckle'), ('magnetic', 'Magnético', 'Magnetic'), ('drawstring', 'Cordón ajustable', 'Drawstring'),
        ('elastic', 'Elástico', 'Elastic'), ('slip_on', 'Sin cierre', 'Slip-on'))),
    'shoe_type': (SELECT, O(('sneakers', 'Tenis', 'Sneakers'), ('running', 'Running', 'Running shoes'), ('boots', 'Botas', 'Boots'), ('sandals', 'Sandalias', 'Sandals'),
        ('heels', 'Tacones', 'Heels'), ('flats', 'Bailarinas', 'Flats'), ('loafers', 'Mocasines', 'Loafers'), ('dress', 'De vestir', 'Dress shoes'),
        ('slippers', 'Pantuflas', 'Slippers'), ('cleats', 'Tacos (fútbol)', 'Cleats'))),
    'bag_type': (SELECT, O(('backpack', 'Mochila', 'Backpack'), ('tote', 'Bolso tote', 'Tote'), ('crossbody', 'Bandolera', 'Crossbody'), ('shoulder', 'Bolso de hombro', 'Shoulder bag'),
        ('handbag', 'Cartera de mano', 'Handbag'), ('clutch', 'Clutch', 'Clutch'), ('duffel', 'Bolso de viaje', 'Duffel'), ('belt_bag', 'Riñonera', 'Belt bag'),
        ('messenger', 'Bolso mensajero', 'Messenger'), ('wallet', 'Billetera', 'Wallet'))),
    'target_gender': (SELECT, O(('women', 'Mujer', 'Women'), ('men', 'Hombre', 'Men'), ('unisex', 'Unisex', 'Unisex'), ('girls', 'Niña', 'Girls'),
        ('boys', 'Niño', 'Boys'), ('kids', 'Niños (unisex)', 'Kids (unisex)'), ('baby', 'Bebé', 'Baby'))),
    'age_group': (SELECT, O(('adult', 'Adulto', 'Adult'), ('teen', 'Adolescente', 'Teen'), ('kids', 'Niños', 'Kids'), ('toddler', 'Niños pequeños', 'Toddler'),
        ('baby', 'Bebé', 'Baby'), ('all_ages', 'Todas las edades', 'All ages'))),
    'material': (COMBO, O(('cotton', 'Algodón', 'Cotton'), ('polyester', 'Poliéster', 'Polyester'), ('nylon', 'Nailon', 'Nylon'), ('wool', 'Lana', 'Wool'),
        ('linen', 'Lino', 'Linen'), ('silk', 'Seda', 'Silk'), ('denim', 'Mezclilla', 'Denim'), ('spandex', 'Elastano', 'Spandex'), ('fleece', 'Polar', 'Fleece'),
        ('leather', 'Cuero', 'Leather'), ('synthetic_leather', 'Cuero sintético', 'Faux leather'), ('fabric', 'Tela', 'Fabric'), ('wood', 'Madera', 'Wood'),
        ('bamboo', 'Bambú', 'Bamboo'), ('metal', 'Metal', 'Metal'), ('stainless_steel', 'Acero inoxidable', 'Stainless steel'), ('aluminum', 'Aluminio', 'Aluminum'),
        ('iron', 'Hierro', 'Iron'), ('plastic', 'Plástico', 'Plastic'), ('glass', 'Vidrio', 'Glass'), ('ceramic', 'Cerámica', 'Ceramic'), ('silicone', 'Silicona', 'Silicone'),
        ('rubber', 'Caucho', 'Rubber'), ('paper', 'Papel', 'Paper'), ('stone', 'Piedra', 'Stone'), ('marble', 'Mármol', 'Marble'))),
    'care_instructions': (COMBO, O(('machine_wash', 'Lavable a máquina', 'Machine wash'), ('hand_wash', 'Lavar a mano', 'Hand wash'), ('dry_clean', 'Limpieza en seco', 'Dry clean only'),
        ('cold_wash', 'Lavar en frío, no usar secadora', 'Machine wash cold, tumble dry low'), ('wipe_clean', 'Limpiar con paño húmedo', 'Wipe clean'))),
    # ---------------------------------------------------------------- jewelry / accessories
    'jewelry_type': (SELECT, O(('ring', 'Anillo', 'Ring'), ('necklace', 'Collar', 'Necklace'), ('earrings', 'Aretes', 'Earrings'), ('bracelet', 'Pulsera', 'Bracelet'),
        ('pendant', 'Colgante', 'Pendant'), ('brooch', 'Broche', 'Brooch'), ('anklet', 'Tobillera', 'Anklet'), ('set', 'Juego', 'Set'))),
    'metal_type': (SELECT, O(('gold_18k', 'Oro 18k', '18k gold'), ('gold_14k', 'Oro 14k', '14k gold'), ('gold_10k', 'Oro 10k', '10k gold'), ('white_gold', 'Oro blanco', 'White gold'),
        ('rose_gold', 'Oro rosa', 'Rose gold'), ('gold_plated', 'Chapado en oro', 'Gold plated'), ('silver_925', 'Plata 925', 'Sterling silver'), ('platinum', 'Platino', 'Platinum'),
        ('stainless_steel', 'Acero inoxidable', 'Stainless steel'), ('titanium', 'Titanio', 'Titanium'), ('brass', 'Latón', 'Brass'))),
    'gemstone': (COMBO, O(('none', 'Sin piedra', 'None'), ('diamond', 'Diamante', 'Diamond'), ('ruby', 'Rubí', 'Ruby'), ('sapphire', 'Zafiro', 'Sapphire'),
        ('emerald', 'Esmeralda', 'Emerald'), ('amethyst', 'Amatista', 'Amethyst'), ('topaz', 'Topacio', 'Topaz'), ('pearl', 'Perla', 'Pearl'),
        ('cubic_zirconia', 'Zirconia', 'Cubic zirconia'), ('amber', 'Ámbar', 'Amber'), ('larimar', 'Larimar', 'Larimar'))),
    'watch_movement': (SELECT, O(('quartz', 'Cuarzo', 'Quartz'), ('automatic', 'Automático', 'Automatic'), ('mechanical', 'Mecánico (cuerda manual)', 'Mechanical (hand-wound)'),
        ('solar', 'Solar', 'Solar'), ('smart', 'Inteligente', 'Smart'))),
    'band_material': (COMBO, O(('silicone', 'Silicona', 'Silicone'), ('leather', 'Cuero', 'Leather'), ('stainless_steel', 'Acero inoxidable', 'Stainless steel'),
        ('nylon', 'Nailon', 'Nylon'), ('titanium', 'Titanio', 'Titanium'), ('ceramic', 'Cerámica', 'Ceramic'), ('fabric', 'Tela', 'Fabric'))),
    'water_resistance': (SELECT, O(('none', 'No resistente', 'Not water resistant'), ('splash', 'Resistente a salpicaduras', 'Splash resistant'), ('ipx4', 'IPX4', 'IPX4'),
        ('ip67', 'IP67', 'IP67'), ('ip68', 'IP68', 'IP68'), ('3atm', '3 ATM (30 m)', '3 ATM (30 m)'), ('5atm', '5 ATM (50 m)', '5 ATM (50 m)'),
        ('10atm', '10 ATM (100 m)', '10 ATM (100 m)'), ('20atm', '20 ATM (200 m)', '20 ATM (200 m)'))),
    'fragrance_concentration': (SELECT, O(('parfum', 'Parfum (extracto)', 'Parfum'), ('edp', 'Eau de Parfum', 'Eau de Parfum'), ('edt', 'Eau de Toilette', 'Eau de Toilette'),
        ('edc', 'Eau de Cologne', 'Eau de Cologne'), ('body_mist', 'Body mist', 'Body mist'))),
    'scent_family': (SELECT, O(('floral', 'Floral', 'Floral'), ('citrus', 'Cítrica', 'Citrus'), ('woody', 'Amaderada', 'Woody'), ('oriental', 'Oriental / ámbar', 'Oriental / amber'),
        ('fresh', 'Fresca', 'Fresh'), ('fruity', 'Frutal', 'Fruity'), ('gourmand', 'Gourmand', 'Gourmand'), ('aromatic', 'Aromática', 'Aromatic'))),
    'skin_type': (SELECT, O(('all', 'Todo tipo de piel', 'All skin types'), ('normal', 'Normal', 'Normal'), ('dry', 'Seca', 'Dry'), ('oily', 'Grasa', 'Oily'),
        ('combination', 'Mixta', 'Combination'), ('sensitive', 'Sensible', 'Sensitive'), ('acne_prone', 'Con tendencia acneica', 'Acne-prone'), ('mature', 'Madura', 'Mature'))),
    'hair_type': (SELECT, O(('all', 'Todo tipo de cabello', 'All hair types'), ('straight', 'Liso', 'Straight'), ('wavy', 'Ondulado', 'Wavy'), ('curly', 'Rizado', 'Curly'),
        ('coily', 'Afro / muy rizado', 'Coily'), ('dry', 'Seco', 'Dry'), ('oily', 'Graso', 'Oily'), ('damaged', 'Dañado', 'Damaged'), ('color_treated', 'Teñido', 'Color-treated'))),
    # ---------------------------------------------------------------- electronics
    'connectivity': (COMBO, O(('bluetooth', 'Bluetooth', 'Bluetooth'), ('wifi', 'Wi-Fi', 'Wi-Fi'), ('wifi_bluetooth', 'Wi-Fi y Bluetooth', 'Wi-Fi and Bluetooth'),
        ('usb', 'USB', 'USB'), ('wired', 'Cableado', 'Wired'), ('nfc', 'NFC', 'NFC'), ('ethernet', 'Ethernet', 'Ethernet'), ('cellular', 'Red celular', 'Cellular'),
        ('infrared', 'Infrarrojo', 'Infrared'), ('zigbee', 'Zigbee', 'Zigbee'))),
    'connector_type': (SELECT, O(('usb_c', 'USB-C', 'USB-C'), ('usb_a', 'USB-A', 'USB-A'), ('micro_usb', 'Micro USB', 'Micro USB'), ('lightning', 'Lightning', 'Lightning'),
        ('hdmi', 'HDMI', 'HDMI'), ('displayport', 'DisplayPort', 'DisplayPort'), ('jack_3_5', 'Jack 3,5 mm', '3.5 mm jack'), ('xlr', 'XLR', 'XLR'), ('rca', 'RCA', 'RCA'),
        ('rj45', 'Ethernet (RJ45)', 'Ethernet (RJ45)'))),
    'power_source': (COMBO, O(('battery', 'Baterías', 'Batteries'), ('rechargeable', 'Batería recargable', 'Rechargeable battery'), ('corded', 'Eléctrico (enchufe)', 'Corded electric'),
        ('usb', 'USB', 'USB'), ('solar', 'Solar', 'Solar'), ('manual', 'Manual', 'Manual'), ('gas', 'Gas', 'Gas'))),
    'operating_system': (SELECT, O(('windows', 'Windows', 'Windows'), ('macos', 'macOS', 'macOS'), ('linux', 'Linux', 'Linux'), ('chromeos', 'ChromeOS', 'ChromeOS'),
        ('android', 'Android', 'Android'), ('ios', 'iOS', 'iOS'), ('ipados', 'iPadOS', 'iPadOS'), ('none', 'Sin sistema operativo', 'No operating system'))),
    'display_resolution': (SELECT, O(('hd', '720p (HD)', '720p (HD)'), ('fhd', '1080p (Full HD)', '1080p (Full HD)'), ('qhd', '1440p (QHD)', '1440p (QHD)'),
        ('uhd_4k', '4K (UHD)', '4K (UHD)'), ('8k', '8K', '8K'))),
    'video_resolution': (SELECT, O(('hd', '720p', '720p'), ('fhd', '1080p', '1080p'), ('2k', '2K', '2K'), ('uhd_4k', '4K', '4K'), ('8k', '8K', '8K'))),
    'panel_type': (SELECT, O(('oled', 'OLED', 'OLED'), ('qled', 'QLED', 'QLED'), ('mini_led', 'Mini LED', 'Mini LED'), ('led', 'LED', 'LED'), ('lcd', 'LCD', 'LCD'),
        ('ips', 'IPS', 'IPS'), ('va', 'VA', 'VA'), ('tn', 'TN', 'TN'))),
    'smart_platform': (SELECT, O(('google_tv', 'Google TV', 'Google TV'), ('android_tv', 'Android TV', 'Android TV'), ('roku', 'Roku TV', 'Roku TV'), ('fire_tv', 'Fire TV', 'Fire TV'),
        ('tizen', 'Tizen (Samsung)', 'Tizen (Samsung)'), ('webos', 'webOS (LG)', 'webOS (LG)'), ('vidaa', 'VIDAA', 'VIDAA'), ('none', 'No es Smart TV', 'Not a smart TV'))),
    'smart_ecosystem': (COMBO, O(('alexa', 'Amazon Alexa', 'Amazon Alexa'), ('google', 'Google Home', 'Google Home'), ('homekit', 'Apple HomeKit', 'Apple HomeKit'),
        ('smartthings', 'SmartThings', 'SmartThings'), ('matter', 'Matter', 'Matter'), ('none', 'Ninguno', 'None'))),
    'wifi_standard': (SELECT, O(('wifi4', 'Wi-Fi 4 (802.11n)', 'Wi-Fi 4 (802.11n)'), ('wifi5', 'Wi-Fi 5 (802.11ac)', 'Wi-Fi 5 (802.11ac)'),
        ('wifi6', 'Wi-Fi 6 (802.11ax)', 'Wi-Fi 6 (802.11ax)'), ('wifi6e', 'Wi-Fi 6E', 'Wi-Fi 6E'), ('wifi7', 'Wi-Fi 7 (802.11be)', 'Wi-Fi 7 (802.11be)'))),
    'cellular_network': (SELECT, O(('5g', '5G', '5G'), ('4g', '4G LTE', '4G LTE'), ('3g', '3G', '3G'), ('none', 'Sin red celular', 'No cellular'))),
    'carrier_lock': (SELECT, O(('unlocked', 'Liberado', 'Unlocked'), ('locked', 'Bloqueado a operador', 'Carrier locked'))),
    'sim_type': (SELECT, O(('nano', 'Nano SIM', 'Nano SIM'), ('esim', 'eSIM', 'eSIM'), ('nano_esim', 'Nano SIM + eSIM', 'Nano SIM + eSIM'), ('dual', 'Dual SIM', 'Dual SIM'))),
    'storage_type': (SELECT, O(('nvme', 'SSD NVMe', 'NVMe SSD'), ('ssd', 'SSD', 'SSD'), ('hdd', 'Disco duro (HDD)', 'Hard drive (HDD)'), ('ssd_hdd', 'SSD + HDD', 'SSD + HDD'),
        ('emmc', 'eMMC', 'eMMC'))),
    'form_factor': (SELECT, O(('laptop', 'Portátil', 'Laptop'), ('desktop', 'Escritorio', 'Desktop'), ('tower', 'Torre', 'Tower'), ('mini_pc', 'Mini PC', 'Mini PC'),
        ('all_in_one', 'Todo en uno', 'All-in-one'), ('tablet', 'Tableta', 'Tablet'), ('convertible', '2 en 1', '2-in-1'))),
    'audio_channels': (SELECT, O(('mono', 'Mono', 'Mono'), ('2_0', '2.0 (estéreo)', '2.0 (stereo)'), ('2_1', '2.1', '2.1'), ('3_1', '3.1', '3.1'), ('5_1', '5.1', '5.1'),
        ('7_1', '7.1', '7.1'), ('atmos', 'Dolby Atmos', 'Dolby Atmos'))),
    'polar_pattern': (SELECT, O(('cardioid', 'Cardioide', 'Cardioid'), ('supercardioid', 'Supercardioide', 'Supercardioid'), ('omnidirectional', 'Omnidireccional', 'Omnidirectional'),
        ('bidirectional', 'Bidireccional (figura 8)', 'Bidirectional (figure-8)'), ('multi', 'Multipatrón', 'Multi-pattern'))),
    'printer_technology': (SELECT, O(('inkjet', 'Inyección de tinta', 'Inkjet'), ('ink_tank', 'Tanque de tinta', 'Ink tank'), ('laser', 'Láser', 'Laser'),
        ('thermal', 'Térmica', 'Thermal'), ('dot_matrix', 'Matricial', 'Dot matrix'), ('3d', '3D', '3D'))),
    'sensor_size': (SELECT, O(('full_frame', 'Full frame', 'Full frame'), ('aps_c', 'APS-C', 'APS-C'), ('micro_four_thirds', 'Micro 4/3', 'Micro Four Thirds'),
        ('one_inch', '1 pulgada', '1-inch'), ('medium_format', 'Formato medio', 'Medium format'), ('smaller', 'Menor a 1 pulgada', 'Smaller than 1-inch'))),
    'lens_mount': (COMBO, O(('canon_rf', 'Canon RF', 'Canon RF'), ('canon_ef', 'Canon EF', 'Canon EF'), ('nikon_z', 'Nikon Z', 'Nikon Z'), ('nikon_f', 'Nikon F', 'Nikon F'),
        ('sony_e', 'Sony E', 'Sony E'), ('fujifilm_x', 'Fujifilm X', 'Fujifilm X'), ('micro_four_thirds', 'Micro 4/3', 'Micro Four Thirds'), ('l_mount', 'L-Mount', 'L-Mount'))),
    'recording_storage': (SELECT, O(('microsd', 'Tarjeta microSD', 'microSD card'), ('cloud', 'Nube', 'Cloud'), ('microsd_cloud', 'microSD y nube', 'microSD and cloud'),
        ('nvr', 'Grabador (NVR/DVR)', 'Recorder (NVR/DVR)'), ('none', 'Sin grabación', 'No recording'))),
    'health_sensors': (COMBO, O(('heart_rate', 'Frecuencia cardíaca', 'Heart rate'), ('spo2', 'Oxígeno en sangre', 'Blood oxygen'), ('ecg', 'ECG', 'ECG'),
        ('sleep', 'Sueño', 'Sleep'), ('temperature', 'Temperatura', 'Temperature'), ('gps', 'GPS', 'GPS'))),
    'gaming_platform': (SELECT, O(('ps5', 'PlayStation 5', 'PlayStation 5'), ('ps4', 'PlayStation 4', 'PlayStation 4'), ('xbox_series', 'Xbox Series X|S', 'Xbox Series X|S'),
        ('xbox_one', 'Xbox One', 'Xbox One'), ('switch', 'Nintendo Switch', 'Nintendo Switch'), ('pc', 'PC', 'PC'), ('mac', 'Mac', 'Mac'), ('mobile', 'Móvil', 'Mobile'))),
    'interface': (COMBO, O(('lga1700', 'LGA 1700', 'LGA 1700'), ('lga1851', 'LGA 1851', 'LGA 1851'), ('am5', 'AM5', 'AM5'), ('am4', 'AM4', 'AM4'), ('pcie5', 'PCIe 5.0', 'PCIe 5.0'),
        ('pcie4', 'PCIe 4.0', 'PCIe 4.0'), ('m2', 'M.2', 'M.2'), ('sata', 'SATA', 'SATA'), ('usb_c', 'USB-C', 'USB-C'))),
    'energy_rating': (SELECT, O(('a_plus_3', 'A+++', 'A+++'), ('a_plus_2', 'A++', 'A++'), ('a_plus', 'A+', 'A+'), ('a', 'A', 'A'), ('b', 'B', 'B'), ('c', 'C', 'C'),
        ('d', 'D', 'D'), ('energy_star', 'Energy Star', 'Energy Star'))),
    'light_source': (SELECT, O(('led', 'LED', 'LED'), ('incandescent', 'Incandescente', 'Incandescent'), ('halogen', 'Halógena', 'Halogen'), ('fluorescent', 'Fluorescente', 'Fluorescent'),
        ('solar', 'Solar', 'Solar'))),
    'base_type': (SELECT, O(('e26', 'E26', 'E26'), ('e27', 'E27', 'E27'), ('e12', 'E12', 'E12'), ('e14', 'E14', 'E14'), ('gu10', 'GU10', 'GU10'), ('g9', 'G9', 'G9'),
        ('mr16', 'MR16', 'MR16'), ('b22', 'B22', 'B22'))),
    'wire_gauge': (SELECT, O(*[(f'awg_{n}', f'{n} AWG', f'{n} AWG') for n in (8, 10, 12, 14, 16, 18, 20, 22, 24)])),
    # ---------------------------------------------------------------- home
    'room': (COMBO, O(('living_room', 'Sala', 'Living room'), ('bedroom', 'Dormitorio', 'Bedroom'), ('kitchen', 'Cocina', 'Kitchen'), ('bathroom', 'Baño', 'Bathroom'),
        ('dining_room', 'Comedor', 'Dining room'), ('office', 'Oficina', 'Office'), ('kids_room', 'Habitación infantil', "Kids' room"), ('outdoor', 'Exterior', 'Outdoor'))),
    'installation_location': (SELECT, O(('indoor', 'Interior', 'Indoor'), ('outdoor', 'Exterior', 'Outdoor'), ('both', 'Interior y exterior', 'Indoor and outdoor'))),
    'installation_type': (SELECT, O(('freestanding', 'Independiente', 'Freestanding'), ('built_in', 'Empotrado', 'Built-in'), ('wall_mounted', 'Montaje en pared', 'Wall-mounted'),
        ('countertop', 'Sobre encimera', 'Countertop'), ('under_counter', 'Bajo encimera', 'Under-counter'), ('ceiling', 'Techo', 'Ceiling'), ('portable', 'Portátil', 'Portable'))),
    'finish': (SELECT, O(('matte', 'Mate', 'Matte'), ('glossy', 'Brillante', 'Glossy'), ('satin', 'Satinado', 'Satin'), ('metallic', 'Metálico', 'Metallic'),
        ('brushed', 'Cepillado', 'Brushed'), ('polished', 'Pulido', 'Polished'), ('textured', 'Texturizado', 'Textured'), ('natural', 'Natural', 'Natural'))),
    'shape': (COMBO, O(('round', 'Redondo', 'Round'), ('square', 'Cuadrado', 'Square'), ('rectangular', 'Rectangular', 'Rectangular'), ('oval', 'Ovalado', 'Oval'),
        ('heart', 'Corazón', 'Heart'), ('irregular', 'Irregular', 'Irregular'))),
    'frame_material': (COMBO, O(('wood', 'Madera', 'Wood'), ('metal', 'Metal', 'Metal'), ('aluminum', 'Aluminio', 'Aluminum'), ('steel', 'Acero', 'Steel'),
        ('plastic', 'Plástico', 'Plastic'), ('acrylic', 'Acrílico', 'Acrylic'))),
    'pile_height': (SELECT, O(('flat', 'Tejido plano', 'Flat weave'), ('low', 'Pelo corto', 'Low pile'), ('medium', 'Pelo medio', 'Medium pile'), ('high', 'Pelo largo', 'High pile'))),
    'compatible_cooktops': (SELECT, O(('all', 'Todas', 'All'), ('gas', 'Gas', 'Gas'), ('electric', 'Eléctrica', 'Electric'), ('induction', 'Inducción', 'Induction'),
        ('ceramic', 'Vitrocerámica', 'Ceramic'))),
    'fuel_type': (SELECT, O(('gasoline', 'Gasolina', 'Gasoline'), ('diesel', 'Diésel', 'Diesel'), ('electric', 'Eléctrico', 'Electric'), ('battery', 'Batería', 'Battery'),
        ('propane', 'Propano', 'Propane'), ('natural_gas', 'Gas natural', 'Natural gas'), ('charcoal', 'Carbón', 'Charcoal'), ('wood', 'Leña', 'Wood'))),
    'sunlight_requirement': (SELECT, O(('full_sun', 'Sol pleno', 'Full sun'), ('partial_shade', 'Semisombra', 'Partial shade'), ('shade', 'Sombra', 'Shade'),
        ('indirect', 'Luz indirecta', 'Bright indirect light'))),
    'target_pests': (COMBO, O(('mosquitoes', 'Mosquitos', 'Mosquitoes'), ('ants', 'Hormigas', 'Ants'), ('cockroaches', 'Cucarachas', 'Cockroaches'), ('rodents', 'Roedores', 'Rodents'),
        ('flies', 'Moscas', 'Flies'), ('termites', 'Termitas', 'Termites'), ('bed_bugs', 'Chinches', 'Bed bugs'), ('fleas_ticks', 'Pulgas y garrapatas', 'Fleas and ticks'))),
    'surface_type': (COMBO, O(('all', 'Todo tipo', 'All surfaces'), ('hardwood', 'Madera', 'Hardwood'), ('tile', 'Cerámica / baldosa', 'Tile'), ('carpet', 'Alfombra', 'Carpet'),
        ('concrete', 'Concreto', 'Concrete'), ('grass', 'Césped', 'Grass'), ('road', 'Carretera', 'Road'), ('trail', 'Montaña / sendero', 'Trail'), ('court', 'Cancha', 'Court'))),
    # ---------------------------------------------------------------- food / pets
    'dietary_preferences': (COMBO, O(('vegan', 'Vegano', 'Vegan'), ('vegetarian', 'Vegetariano', 'Vegetarian'), ('gluten_free', 'Sin gluten', 'Gluten-free'),
        ('sugar_free', 'Sin azúcar', 'Sugar-free'), ('lactose_free', 'Sin lactosa', 'Lactose-free'), ('keto', 'Keto', 'Keto'), ('organic', 'Orgánico', 'Organic'),
        ('non_gmo', 'Sin OGM', 'Non-GMO'), ('kosher', 'Kosher', 'Kosher'), ('halal', 'Halal', 'Halal'))),
    'allergen_information': (COMBO, O(('none', 'Sin alérgenos declarados', 'No declared allergens'), ('gluten', 'Contiene gluten', 'Contains gluten'), ('milk', 'Contiene leche', 'Contains milk'),
        ('eggs', 'Contiene huevo', 'Contains eggs'), ('tree_nuts', 'Contiene frutos secos', 'Contains tree nuts'), ('peanuts', 'Contiene maní', 'Contains peanuts'),
        ('soy', 'Contiene soya', 'Contains soy'), ('fish', 'Contiene pescado', 'Contains fish'), ('shellfish', 'Contiene mariscos', 'Contains shellfish'),
        ('sesame', 'Contiene sésamo', 'Contains sesame'))),
    'product_form': (COMBO, O(('powder', 'Polvo', 'Powder'), ('liquid', 'Líquido', 'Liquid'), ('capsules', 'Cápsulas', 'Capsules'), ('tablets', 'Tabletas', 'Tablets'),
        ('gummies', 'Gomitas', 'Gummies'), ('cream', 'Crema', 'Cream'), ('gel', 'Gel', 'Gel'), ('spray', 'Spray', 'Spray'), ('bar', 'Barra', 'Bar'),
        ('whole_bean', 'En grano', 'Whole bean'), ('ground', 'Molido', 'Ground'), ('pods', 'Cápsulas monodosis', 'Pods'), ('bags', 'En bolsitas', 'Bags'))),
    'caffeine_content': (SELECT, O(('caffeinated', 'Con cafeína', 'Caffeinated'), ('half_caf', 'Mitad cafeína', 'Half-caf'), ('decaf', 'Descafeinado', 'Decaf'),
        ('caffeine_free', 'Sin cafeína', 'Caffeine-free'))),
    'roast_level': (SELECT, O(('light', 'Claro', 'Light'), ('medium', 'Medio', 'Medium'), ('medium_dark', 'Medio oscuro', 'Medium-dark'), ('dark', 'Oscuro', 'Dark'))),
    'bean_origin': (COMBO, O(('dominican_republic', 'República Dominicana', 'Dominican Republic'), ('colombia', 'Colombia', 'Colombia'), ('brazil', 'Brasil', 'Brazil'),
        ('ethiopia', 'Etiopía', 'Ethiopia'), ('guatemala', 'Guatemala', 'Guatemala'), ('costa_rica', 'Costa Rica', 'Costa Rica'), ('honduras', 'Honduras', 'Honduras'),
        ('mexico', 'México', 'Mexico'), ('peru', 'Perú', 'Peru'), ('kenya', 'Kenia', 'Kenya'), ('blend', 'Mezcla de orígenes', 'Blend'))),
    'tea_type': (SELECT, O(('black', 'Negro', 'Black'), ('green', 'Verde', 'Green'), ('white', 'Blanco', 'White'), ('oolong', 'Oolong', 'Oolong'),
        ('herbal', 'Infusión herbal', 'Herbal'), ('rooibos', 'Rooibos', 'Rooibos'), ('chai', 'Chai', 'Chai'), ('matcha', 'Matcha', 'Matcha'), ('mate', 'Yerba mate', 'Yerba mate'))),
    'cuisine': (COMBO, O(('latin', 'Latinoamericana', 'Latin American'), ('caribbean', 'Caribeña', 'Caribbean'), ('mexican', 'Mexicana', 'Mexican'), ('italian', 'Italiana', 'Italian'),
        ('mediterranean', 'Mediterránea', 'Mediterranean'), ('asian', 'Asiática', 'Asian'), ('american', 'Americana', 'American'))),
    'animal_type': (SELECT, O(('dog', 'Perro', 'Dog'), ('cat', 'Gato', 'Cat'), ('bird', 'Ave', 'Bird'), ('fish', 'Pez', 'Fish'), ('small_animal', 'Pequeños mamíferos', 'Small animal'),
        ('reptile', 'Reptil', 'Reptile'), ('horse', 'Caballo', 'Horse'))),
    'pet_life_stage': (SELECT, O(('all', 'Todas las etapas', 'All life stages'), ('puppy_kitten', 'Cachorro / gatito', 'Puppy / kitten'), ('adult', 'Adulto', 'Adult'),
        ('senior', 'Senior', 'Senior'))),
    'pet_size': (SELECT, O(('all', 'Todos los tamaños', 'All sizes'), ('toy', 'Muy pequeño', 'Toy'), ('small', 'Pequeño', 'Small'), ('medium', 'Mediano', 'Medium'),
        ('large', 'Grande', 'Large'), ('giant', 'Muy grande', 'Giant'))),
    'water_type': (SELECT, O(('freshwater', 'Agua dulce', 'Freshwater'), ('saltwater', 'Agua salada', 'Saltwater'), ('both', 'Agua dulce y salada', 'Fresh and saltwater'))),
    # ---------------------------------------------------------------- kids / toys / books / media
    'child_age_range': (SELECT, O(('0_6m', '0–6 meses', '0–6 months'), ('6_12m', '6–12 meses', '6–12 months'), ('1_2y', '1–2 años', '1–2 years'), ('3_4y', '3–4 años', '3–4 years'),
        ('5_7y', '5–7 años', '5–7 years'), ('8_11y', '8–11 años', '8–11 years'), ('12_plus', '12 años o más', '12+ years'))),
    'skill_level': (SELECT, O(('all', 'Todos los niveles', 'All levels'), ('beginner', 'Principiante', 'Beginner'), ('intermediate', 'Intermedio', 'Intermediate'),
        ('advanced', 'Avanzado', 'Advanced'), ('professional', 'Profesional', 'Professional'))),
    'player_count': (SELECT, O(('1', '1 jugador', '1 player'), ('2', '2 jugadores', '2 players'), ('2_4', '2–4 jugadores', '2–4 players'), ('2_6', '2–6 jugadores', '2–6 players'),
        ('4_plus', '4 o más jugadores', '4+ players'), ('6_plus', '6 o más jugadores', '6+ players'))),
    'educational_focus': (COMBO, O(('stem', 'STEM', 'STEM'), ('reading', 'Lectura', 'Reading'), ('math', 'Matemáticas', 'Math'), ('motor_skills', 'Motricidad', 'Motor skills'),
        ('creativity', 'Creatividad', 'Creativity'), ('languages', 'Idiomas', 'Languages'), ('social', 'Habilidades sociales', 'Social skills'))),
    'education_level': (SELECT, O(('preschool', 'Preescolar', 'Preschool'), ('primary', 'Primaria', 'Primary'), ('secondary', 'Secundaria', 'Secondary'),
        ('university', 'Universidad', 'University'), ('professional', 'Profesional', 'Professional'))),
    'subject': (COMBO, O(('math', 'Matemáticas', 'Math'), ('science', 'Ciencias', 'Science'), ('reading', 'Lengua y lectura', 'Language arts'), ('history', 'Historia', 'History'),
        ('geography', 'Geografía', 'Geography'), ('languages', 'Idiomas', 'Foreign languages'), ('art', 'Arte', 'Art'), ('music', 'Música', 'Music'), ('technology', 'Tecnología', 'Technology'))),
    'book_format': (SELECT, O(('hardcover', 'Tapa dura', 'Hardcover'), ('paperback', 'Tapa blanda', 'Paperback'), ('board_book', 'Libro de cartón', 'Board book'),
        ('spiral', 'Espiral', 'Spiral-bound'), ('ebook', 'Libro electrónico', 'eBook'), ('audiobook', 'Audiolibro', 'Audiobook'))),
    'media_format': (SELECT, O(('dvd', 'DVD', 'DVD'), ('bluray', 'Blu-ray', 'Blu-ray'), ('uhd_bluray', '4K Ultra HD Blu-ray', '4K Ultra HD Blu-ray'), ('cd', 'CD', 'CD'),
        ('vinyl', 'Vinilo', 'Vinyl'), ('cassette', 'Casete', 'Cassette'), ('digital', 'Digital', 'Digital'))),
    'region_code': (SELECT, O(('region_free', 'Libre de región', 'Region free'), ('region_1', 'Región 1 (EE. UU. / Canadá)', 'Region 1 (US / Canada)'),
        ('region_2', 'Región 2 (Europa)', 'Region 2 (Europe)'), ('region_4', 'Región 4 (Latinoamérica)', 'Region 4 (Latin America)'), ('bd_a', 'Blu-ray A', 'Blu-ray A'),
        ('bd_b', 'Blu-ray B', 'Blu-ray B'), ('bd_c', 'Blu-ray C', 'Blu-ray C'))),
    'content_rating': (SELECT, O(('everyone', 'Todo público (E)', 'Everyone (E)'), ('everyone_10', 'Mayores de 10 (E10+)', 'Everyone 10+ (E10+)'), ('teen', 'Adolescentes (T)', 'Teen (T)'),
        ('mature', 'Mayores de 17 (M)', 'Mature 17+ (M)'), ('adults_only', 'Solo adultos (AO)', 'Adults only (AO)'), ('g', 'G', 'G'), ('pg', 'PG', 'PG'), ('pg13', 'PG-13', 'PG-13'),
        ('r', 'R', 'R'), ('unrated', 'Sin clasificar', 'Unrated'))),
    'genre': (COMBO, O(('fiction', 'Ficción', 'Fiction'), ('non_fiction', 'No ficción', 'Non-fiction'), ('romance', 'Romance', 'Romance'), ('mystery', 'Misterio', 'Mystery'),
        ('science_fiction', 'Ciencia ficción', 'Science fiction'), ('fantasy', 'Fantasía', 'Fantasy'), ('horror', 'Terror', 'Horror'), ('biography', 'Biografía', 'Biography'),
        ('self_help', 'Autoayuda', 'Self-help'), ('children', 'Infantil', "Children's"), ('comedy', 'Comedia', 'Comedy'), ('drama', 'Drama', 'Drama'), ('action', 'Acción', 'Action'),
        ('rock', 'Rock', 'Rock'), ('pop', 'Pop', 'Pop'), ('latin', 'Música latina', 'Latin music'), ('classical', 'Clásica', 'Classical'), ('jazz', 'Jazz', 'Jazz'))),
    'edition': (COMBO, O(('standard', 'Estándar', 'Standard'), ('first', 'Primera edición', 'First edition'), ('special', 'Especial', 'Special'), ('deluxe', 'Deluxe', 'Deluxe'),
        ('limited', 'Limitada', 'Limited'), ('collector', 'De coleccionista', "Collector's"))),
    'language': (COMBO, O(('es', 'Español', 'Spanish'), ('en', 'Inglés', 'English'), ('pt', 'Portugués', 'Portuguese'), ('fr', 'Francés', 'French'), ('de', 'Alemán', 'German'),
        ('it', 'Italiano', 'Italian'), ('zh', 'Chino', 'Chinese'), ('ja', 'Japonés', 'Japanese'), ('bilingual', 'Bilingüe español-inglés', 'Bilingual Spanish-English'),
        ('multi', 'Multilingüe', 'Multilingual'))),
    'art_medium': (COMBO, O(('oil', 'Óleo', 'Oil'), ('acrylic', 'Acrílico', 'Acrylic'), ('watercolor', 'Acuarela', 'Watercolor'), ('charcoal', 'Carboncillo', 'Charcoal'),
        ('pencil', 'Lápiz', 'Pencil'), ('ink', 'Tinta', 'Ink'), ('digital', 'Digital', 'Digital'), ('mixed', 'Técnica mixta', 'Mixed media'), ('photography', 'Fotografía', 'Photography'))),
    'paper_size': (SELECT, O(('letter', 'Carta', 'Letter'), ('legal', 'Oficio / legal', 'Legal'), ('a4', 'A4', 'A4'), ('a5', 'A5', 'A5'), ('a3', 'A3', 'A3'),
        ('tabloid', 'Tabloide', 'Tabloid'), ('photo_4x6', '4 × 6 in (foto)', '4 × 6 in (photo)'))),
    'ruling': (SELECT, O(('college', 'Rayado universitario', 'College ruled'), ('wide', 'Rayado ancho', 'Wide ruled'), ('grid', 'Cuadriculado', 'Graph'), ('dotted', 'Punteado', 'Dot grid'),
        ('blank', 'Sin rayas', 'Blank'))),
    'yarn_weight': (SELECT, O(('lace', 'Encaje (0)', 'Lace (0)'), ('super_fine', 'Superfino (1)', 'Super fine (1)'), ('fine', 'Fino (2)', 'Fine (2)'), ('light', 'Ligero (3)', 'Light (3)'),
        ('medium', 'Medio (4)', 'Medium (4)'), ('bulky', 'Grueso (5)', 'Bulky (5)'), ('super_bulky', 'Muy grueso (6)', 'Super bulky (6)'), ('jumbo', 'Jumbo (7)', 'Jumbo (7)'))),
    'scale': (COMBO, O(*[(f'1_{n}', f'1:{n}', f'1:{n}') for n in (12, 18, 24, 32, 43, 64, 72, 144)])),
    'grading': (SELECT, O(('ungraded', 'Sin certificar', 'Ungraded'), ('psa', 'PSA', 'PSA'), ('bgs', 'BGS (Beckett)', 'BGS (Beckett)'), ('cgc', 'CGC', 'CGC'), ('sgc', 'SGC', 'SGC'))),
    'shell_type': (SELECT, O(('hard', 'Rígida', 'Hard shell'), ('soft', 'Blanda', 'Soft shell'), ('hybrid', 'Híbrida', 'Hybrid'))),
    'handedness': (SELECT, O(('right', 'Diestro', 'Right-handed'), ('left', 'Zurdo', 'Left-handed'), ('ambidextrous', 'Ambidiestro', 'Ambidextrous'))),
    'sport': (COMBO, O(('soccer', 'Fútbol', 'Soccer'), ('baseball', 'Béisbol', 'Baseball'), ('basketball', 'Baloncesto', 'Basketball'), ('volleyball', 'Voleibol', 'Volleyball'),
        ('running', 'Running', 'Running'), ('fitness', 'Fitness / gimnasio', 'Fitness'), ('yoga', 'Yoga', 'Yoga'), ('cycling', 'Ciclismo', 'Cycling'), ('swimming', 'Natación', 'Swimming'),
        ('tennis', 'Tenis', 'Tennis'), ('golf', 'Golf', 'Golf'), ('boxing', 'Boxeo', 'Boxing'), ('hiking', 'Senderismo', 'Hiking'))),
    'safety_certification': (COMBO, O(('ce', 'CE', 'CE'), ('ul', 'UL', 'UL'), ('etl', 'ETL', 'ETL'), ('fcc', 'FCC', 'FCC'), ('astm_f963', 'ASTM F963', 'ASTM F963'),
        ('en71', 'EN 71', 'EN 71'), ('cpsia', 'CPSIA', 'CPSIA'), ('iso', 'ISO', 'ISO'), ('nom', 'NOM', 'NOM'))),
    'placement': (SELECT, O(('universal', 'Universal', 'Universal'), ('front', 'Delantero', 'Front'), ('rear', 'Trasero', 'Rear'), ('left', 'Izquierdo (conductor)', 'Left (driver)'),
        ('right', 'Derecho (pasajero)', 'Right (passenger)'), ('interior', 'Interior', 'Interior'), ('exterior', 'Exterior', 'Exterior'))),
    'speed_rating': (SELECT, O(('q', 'Q (160 km/h)', 'Q (99 mph)'), ('r', 'R (170 km/h)', 'R (106 mph)'), ('s', 'S (180 km/h)', 'S (112 mph)'), ('t', 'T (190 km/h)', 'T (118 mph)'),
        ('h', 'H (210 km/h)', 'H (130 mph)'), ('v', 'V (240 km/h)', 'V (149 mph)'), ('w', 'W (270 km/h)', 'W (168 mph)'), ('y', 'Y (300 km/h)', 'Y (186 mph)'),
        ('zr', 'ZR (más de 240 km/h)', 'ZR (over 149 mph)'))),
    # open lists without curated options: values typed by sellers become suggestions
    'item_type': (COMBO, []), 'theme': (COMBO, []), 'character_franchise': (COMBO, []), 'compatible_with': (COMBO, []), 'measurement_type': (COMBO, []),
    'processor': (COMBO, []), 'gpu': (COMBO, []), 'functions': (COMBO, []), 'lens_features': (COMBO, []), 'series': (COMBO, []), 'publisher': (COMBO, []),
    'record_label': (COMBO, []), 'author': (COMBO, []), 'artist': (COMBO, []),
    # free text
    **{c: (TEXT, []) for c in ('model_number', 'part_number', 'isbn', 'ingredients', 'active_ingredients', 'storage_instructions', 'contents', 'vehicle_compatibility',
                               'net_quantity', 'size_spec', 'measuring_range', 'accuracy', 'load_index', 'map_coverage', 'connection_size', 'child_weight_range')},
}

# Distinct Spanish names for attributes that shared one ("Formato" ×3, "Género" ×2).
RENAMES = {'book_format': ('Formato del libro', 'Book Format'), 'form_factor': ('Factor de forma', 'Form Factor'),
           'media_format': ('Formato del soporte', 'Media Format'), 'target_gender': ('Dirigido a', 'Gender')}


def sql():
    out = ['-- Generated by scripts/data/attribute_options.py — attribute option lists (ES/EN) and fixture cleanup.', 'begin;', '']
    out.append("""-- 1) Test fixtures left by catalog migration tests: archived "Catalog Root"/"Categoría Prueba QA" trees and their catalog-* attributes.
do $$
declare ids uuid[];
begin
  with recursive t as (
    select id from public.categories where status = 'ARCHIVED' and ((name = 'Catalog Root' and slug like 'catalog-root-%') or slug like 'categoria-prueba-qa%')
    union all select c.id from public.categories c join t on c.parent_id = t.id where c.status = 'ARCHIVED')
  select array_agg(id) into ids from t;
  if ids is not null then
    if exists (select 1 from public.products where category_id = any(ids)) then raise exception 'fixture categories have products'; end if;
    delete from public.category_attribute_definitions where category_id = any(ids);
    delete from public.category_variant_option_templates where category_id = any(ids);
    update public.categories set parent_id = null where id = any(ids);
    delete from public.categories where id = any(ids);
  end if;
  delete from public.category_attribute_definitions where attribute_definition_id in (select id from public.attribute_definitions where code ~ '^catalog-');
  delete from public.attribute_definitions ad where ad.code ~ '^catalog-'
    and not exists (select 1 from public.product_attribute_values v where v.attribute_definition_id = ad.id);
end $$;
""")
    out.append('-- 2) Distinct names for attributes that shared one.')
    for code, (es, _en) in RENAMES.items():
        out.append(f"update public.attribute_definitions set name = {lit(es)} where code = {lit(code)};")
    out.append('')
    out.append('-- 3) Input mode and options per attribute (validation_rules.input / validation_rules.options).')
    for code, (mode, opts) in sorted(ATTRS.items()):
        rules = {'input': mode, 'options': [{'value': v, 'label': es, 'labelEn': en} for v, es, en in opts]}
        out.append(f"update public.attribute_definitions set validation_rules = coalesce(validation_rules, '{{}}'::jsonb) || {lit(json.dumps(rules, ensure_ascii=False))}::jsonb where code = {lit(code)};")
    out += ['', 'commit;', '']
    return '\n'.join(out)


def lit(s):
    return "'" + s.replace("'", "''") + "'"


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--json':
        print(json.dumps({c: {'input': m, 'options': o} for c, (m, o) in ATTRS.items()}, ensure_ascii=False, indent=1))
    else:
        sys.stdout.write(sql())
