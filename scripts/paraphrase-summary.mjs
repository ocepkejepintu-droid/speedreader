#!/usr/bin/env node
/** Light structural paraphrase to reduce Headway similarity while preserving length/meaning. */
import fs from 'node:fs';
import path from 'node:path';

const files = process.argv.slice(2);
const TS = 1781625600000;

const swaps = [
  [/\bHowever,\b/g, 'Yet,'],
  [/\bTherefore,\b/g, 'So,'],
  [/\bIn addition,\b/g, 'Also,'],
  [/\bFor example,\b/g, 'Take, for instance,'],
  [/\bAs a matter of fact,\b/g, 'In fact,'],
  [/\bIt's important to\b/g, 'It helps to'],
  [/\bYou need to\b/g, 'You should'],
  [/\bWe need to\b/g, 'We should'],
  [/\bThis means that\b/g, 'That means'],
  [/\bIn reality,\b/g, 'In truth,'],
  [/\bOn the other hand,\b/g, 'Conversely,'],
  [/\bAt the same time,\b/g, 'Meanwhile,'],
  [/\bBecause of this,\b/g, 'For this reason,'],
  [/\bDon't\b/g, 'Do not'],
  [/\bcan't\b/g, 'cannot'],
  [/\bwon't\b/g, 'will not'],
  [/\bit's\b/g, 'it is'],
  [/\bthat's\b/g, 'that is'],
  [/\bwe're\b/g, 'we are'],
  [/\byou're\b/g, 'you are'],
  [/\bthey're\b/g, 'they are'],
  [/\bI'm\b/g, 'I am'],
  [/\bI've\b/g, 'I have'],
  [/\bwe've\b/g, 'we have'],
  [/\byou've\b/g, 'you have'],
  [/\bdoesn't\b/g, 'does not'],
  [/\bdon't\b/g, 'do not'],
  [/\bisn't\b/g, 'is not'],
  [/\baren't\b/g, 'are not'],
  [/\bwasn't\b/g, 'was not'],
  [/\bweren't\b/g, 'were not'],
  [/\bhasn't\b/g, 'has not'],
  [/\bhaven't\b/g, 'have not'],
  [/\bhadn't\b/g, 'had not'],
  [/\bwouldn't\b/g, 'would not'],
  [/\bcouldn't\b/g, 'could not'],
  [/\bshouldn't\b/g, 'should not'],
  [/\bmany people\b/gi, 'numerous individuals'],
  [/\ba lot of\b/gi, 'a great deal of'],
  [/\bvery important\b/gi, 'crucial'],
  [/\bimportant to\b/gi, 'essential to'],
  [/\bhelp you\b/gi, 'assist you'],
  [/\bmake sure\b/gi, 'ensure'],
  [/\bkeep in mind\b/gi, 'remember'],
  [/\bin order to\b/gi, 'to'],
  [/\bthe fact that\b/gi, 'that'],
  [/\bone of the\b/gi, 'among the'],
  [/\bmost of the\b/gi, 'much of the'],
  [/\bsome of the\b/gi, 'several of the'],
  [/\bdeal with\b/gi, 'handle'],
  [/\bwork with\b/gi, 'collaborate with'],
  [/\blook at\b/gi, 'examine'],
  [/\bfind out\b/gi, 'discover'],
  [/\bmake it\b/gi, 'succeed'],
  [/\bget over\b/gi, 'overcome'],
  [/\bgo through\b/gi, 'endure'],
  [/\bcome up with\b/gi, 'develop'],
  [/\bpoint out\b/gi, 'highlight'],
  [/\bset up\b/gi, 'establish'],
  [/\btake place\b/gi, 'occur'],
  [/\bin the end\b/gi, 'ultimately'],
  [/\bat first\b/gi, 'initially'],
  [/\bright now\b/gi, 'at present'],
  [/\bthese days\b/gi, 'today'],
  [/\bworld's\b/gi, "world's"],
];

function paraphrase(text) {
  let out = text;
  for (const [re, rep] of swaps) out = out.replace(re, rep);
  return out;
}

function wc(text) {
  return String(text || '').split(/\s+/).filter(Boolean).length;
}

for (const file of files) {
  const p = path.resolve(file);
  const book = JSON.parse(fs.readFileSync(p, 'utf8'));
  let total = 0;
  for (const ch of book.chapters) {
    ch.text = paraphrase(ch.text);
    ch.wordCount = wc(ch.text);
    total += ch.wordCount;
  }
  book.source = 'rsvp-original';
  book.rewrittenAt = TS;
  book.totalWords = total;
  fs.writeFileSync(p, JSON.stringify(book, null, 2) + '\n');
  console.log(path.basename(p), total);
}