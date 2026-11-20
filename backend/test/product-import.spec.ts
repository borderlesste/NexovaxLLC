import { normalizeImageUrl, parseCount, parseCsv, parseMeasure, parseMoney, rowsFromSheet, splitImageUrls, decodeCsv } from '../src/seller/product-import.parse';
import { isPublicAddress, sniffImage } from '../src/common/safe-fetch';

describe('product import parsing', () => {
  it('reads prices written in different styles', () => {
    expect(parseMoney('1299')).toBe('1299.00');
    expect(parseMoney('$1,299.50')).toBe('1299.50');
    expect(parseMoney('1.299,50')).toBe('1299.50');
    expect(parseMoney('RD$ 850')).toBe('850.00');
    expect(parseMoney('12,5')).toBe('12.50');
    expect(parseMoney('1,299')).toBe('1299.00');
    expect(parseMoney('1.299')).toBe('1299.00');
    expect(parseMoney('19.99')).toBe('19.99');
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('-5')).toBeNull();
  });

  it('reads counts and measures', () => {
    expect(parseCount('12')).toBe(12);
    expect(parseCount('12.0')).toBe(12);
    expect(parseCount('1,200')).toBe(1200);
    expect(parseCount('-1')).toBeNull();
    expect(parseCount('2.5')).toBeNull();
    expect(parseMeasure('0,5')).toBe(0.5);
    expect(parseMeasure('30 cm')).toBe(30);
    expect(parseMeasure('0')).toBeNull();
  });

  it('parses CSV with semicolons, quotes and line breaks inside cells', () => {
    const rows = parseCsv('﻿SKU *;Nombre *;Descripción *\r\nA-1;"Camisa ""azul""";"Línea 1\nLínea 2"\r\n');
    expect(rows).toEqual([['SKU *', 'Nombre *', 'Descripción *'], ['A-1', 'Camisa "azul"', 'Línea 1\nLínea 2']]);
  });

  it('decodes Windows-1252 CSV files', () => {
    expect(decodeCsv(Buffer.from([0x43, 0x61, 0x6d, 0x69, 0xf3, 0x6e]))).toBe('Camión');
    expect(decodeCsv(Buffer.from('Camión', 'utf8'))).toBe('Camión');
  });

  it('maps template and alternative headers to fields and skips empty rows', () => {
    const { rows, unknownColumns } = rowsFromSheet([
      ['Mi catálogo'],
      ['SKU *', 'Nombre *', 'Precio *', 'Stock *', 'Peso (kg) *', 'Imágenes (enlaces)', 'Opción 1 nombre', 'Notas'],
      ['a-1', 'Camisa', 12.5, 3, 0.4, 'https://x.com/a.jpg', 'Talla', 'interno'],
      [null, '', null],
      ['a-2', 'Gorra', '9.99', '1', '0.2', '', '', ''],
    ]);
    expect(unknownColumns).toEqual(['Notas']);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ row: 3, sku: 'a-1', title: 'Camisa', price: '12.5', stock: '3', weightKg: '0.4', images: 'https://x.com/a.jpg', option1Name: 'Talla' });
    expect(rows[1].row).toBe(5);
  });

  it('rejects files without the required columns', () => {
    expect(() => rowsFromSheet([['SKU', 'Nombre'], ['A', 'B']])).toThrow(/Precio, Stock/);
    expect(() => rowsFromSheet([['foo', 'bar']])).toThrow(/encabezados/);
  });

  it('turns share links into direct downloads and refuses other schemes', () => {
    expect(normalizeImageUrl('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing')).toBe('https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp');
    expect(normalizeImageUrl('https://www.dropbox.com/s/abc/foto.jpg?dl=0')).toBe('https://www.dropbox.com/s/abc/foto.jpg?raw=1');
    expect(normalizeImageUrl('ftp://x.com/a.jpg')).toBeNull();
    expect(normalizeImageUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeImageUrl('https://user:pw@x.com/a.jpg')).toBeNull();
    expect(splitImageUrls('https://a.com/1.jpg, https://a.com/2.jpg | https://a.com/1.jpg')).toEqual(['https://a.com/1.jpg', 'https://a.com/2.jpg']);
  });
});

describe('image download safety', () => {
  it('only allows public addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', 'not-an-ip'])
      expect(isPublicAddress(ip)).toBe(false);
    for (const ip of ['8.8.8.8', '151.101.1.69', '2606:4700::6810:84e5']) expect(isPublicAddress(ip)).toBe(true);
  });

  it('recognises image formats from their bytes', () => {
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImage(Buffer.from('89504e470d0a1a0a0000', 'hex'))).toBe('image/png');
    expect(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'binary'))).toBe('image/webp');
    expect(sniffImage(Buffer.from('<!doctype html>'))).toBeNull();
  });
});
