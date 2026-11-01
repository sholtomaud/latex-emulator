import { describe, test } from 'node:test';
import assert from 'node:assert';
import { parseReferenceInput } from './input.ts';

describe('parseReferenceInput', () => {
  test('a bare DOI, with or without doi: and surrounding punctuation', () => {
    for (const s of [
      '10.1016/j.ecolmodel.2003.12.032',
      ' doi:10.1016/j.ecolmodel.2003.12.032. ',
      '(10.1016/j.ecolmodel.2003.12.032)',
    ])
      assert.deepStrictEqual(parseReferenceInput(s), {
        kind: 'doi',
        doi: '10.1016/j.ecolmodel.2003.12.032',
      });
  });

  test('DOIs inside doi.org and publisher URLs, URL-decoded', () => {
    assert.deepStrictEqual(
      parseReferenceInput(
        'https://doi.org/10.1002/(SICI)1097-4571(199806)49:8%3C693::AID-ASI4%3E3.0.CO;2-0'
      ),
      {
        kind: 'doi',
        doi: '10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-0',
      }
    );
    assert.deepStrictEqual(
      parseReferenceInput(
        'https://onlinelibrary.wiley.com/doi/10.1111/j.1461-0248.2004.00680.x'
      ),
      { kind: 'doi', doi: '10.1111/j.1461-0248.2004.00680.x' }
    );
    assert.deepStrictEqual(
      parseReferenceInput(
        'https://www.sciencedirect.com/science/article/pii/S0304380004001449?via%3Dihub#sec1'
      ),
      {
        kind: 'url',
        url: 'https://www.sciencedirect.com/science/article/pii/S0304380004001449?via%3Dihub#sec1',
      }
    );
  });

  test('arXiv IDs and URLs become their DataCite DOI (version dropped)', () => {
    for (const s of [
      'arXiv:2101.00001v2',
      'https://arxiv.org/abs/2101.00001',
      'https://arxiv.org/pdf/2101.00001v3',
    ])
      assert.deepStrictEqual(parseReferenceInput(s), {
        kind: 'doi',
        doi: '10.48550/arXiv.2101.00001',
      });
    assert.deepStrictEqual(
      parseReferenceInput('https://arxiv.org/abs/hep-th/9901001'),
      {
        kind: 'doi',
        doi: '10.48550/arXiv.hep-th/9901001',
      }
    );
  });

  test('other http(s) URLs are kept; everything else is invalid', () => {
    assert.deepStrictEqual(parseReferenceInput('https://example.org/eroi'), {
      kind: 'url',
      url: 'https://example.org/eroi',
    });
    for (const s of [
      '',
      'not a reference',
      'javascript:alert(1)',
      'ftp://x.org/a',
      'http://',
    ])
      assert.deepStrictEqual(parseReferenceInput(s), { kind: 'invalid' });
  });
});
