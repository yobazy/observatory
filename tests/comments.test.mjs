import test from 'node:test';
import assert from 'node:assert/strict';
import { commentPrompt, spotText } from '../src/nebula/commentText.ts';

const c = (target, note) => ({ id: note, target, note, sent: false });

test('a note on a picture names the spot as a share of its width and height', () => {
  assert.equal(spotText({ x: 0.404, y: 0.25 }), '40% across, 25% down');
  const prompt = commentPrompt('/tmp/board.jpg', 'picture', [
    c({ selector: '', tag: 'img', text: '', at: { x: 0.1, y: 0.9 } }, 'This logo is too small'),
  ]);
  assert.equal(
    prompt,
    'Notes on the picture at /tmp/board.jpg. Please take these into account:\n\n' +
      '1. The spot 10% across, 90% down the picture: This logo is too small',
  );
});

test('docs and mockups keep their wording', () => {
  const h = c({ selector: '', tag: 'h2', text: 'Pricing' }, 'Shorter');
  assert.match(commentPrompt('/a.md', 'doc', [h]), /^Feedback on the doc at \/a\.md\..*\n\n1\. The heading "Pricing": Shorter$/s);
  const b = c({ selector: '#buy', tag: 'button', text: 'Buy' }, 'Bigger');
  assert.match(commentPrompt('/a.html', 'page', [b]), /1\. The <button> "Buy" \(#buy\): Bigger$/);
});
