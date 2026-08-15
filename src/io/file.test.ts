import { describe, expect, it } from 'vitest';
import { mimeFor } from './file';

describe('mimeFor', () => {
  it('labels every export the app produces', () => {
    // The browser download path is the only one the web and phone builds have,
    // and Android decides what to do with a file by its content type.
    expect(mimeFor('pdf')).toBe('application/pdf');
    expect(mimeFor('png')).toBe('image/png');
    expect(mimeFor('svg')).toBe('image/svg+xml');
    expect(mimeFor('txt')).toBe('text/plain');
    expect(mimeFor('knitchart')).toBe('application/json');
  });

  it('does not claim a PDF is an image', () => {
    // It did: every binary export was labelled image/png, so a saved pattern
    // arrived as an image and Android offered it to a photo viewer.
    expect(mimeFor('pdf')).not.toBe('image/png');
  });

  it('ignores case', () => {
    expect(mimeFor('PDF')).toBe('application/pdf');
  });

  it('falls back to a neutral type rather than guessing', () => {
    expect(mimeFor('zip')).toBe('application/octet-stream');
  });
});
