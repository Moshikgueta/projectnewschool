#!/usr/bin/env node
/* Unit tests for the answer checker (functions/learn/grade.js).
     node scripts/test-grade.mjs */
import { gradeText, normalize, isRight } from '../functions/learn/grade.js';

let pass = 0, fail = 0;
function t(name, got, want) {
  if (got === want) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log(`  ✗ ${name}: got ${got}, want ${want}`); }
}
const ES = { accents: 'strict', stopwords: ['el', 'la', 'en', 'a', 'de', 'los', 'las', 'y', 'se', 'le'] };
const PRON = { ...ES, optionalLeading: ['yo', 'tú', 'él', 'ella', 'nosotros', 'ellos'] };
const s = (g, a, p = ES, q = '') => gradeText(g, a, p, q).status;

console.log('Spanish');
t('exact', s('Me levanto a las siete.', ['Me levanto a las siete.']), 'correct');
t('case, spaces, punctuation ignored', s('  me LEVANTO   a las siete ', ['Me levanto a las siete.']), 'correct');
t('¿? ignored', s('Donde vives', ['¿Dónde vives?'], { ...ES, accents: 'lenient' }), 'accepted_accent');
t('missing accent is not right in strict mode', s('Donde vives', ['¿Dónde vives?']), 'almost');
t('esta vs está is not accepted', isRight(s('Ana esta en casa', ['Ana está en casa'])), false);
t('hablo vs habló is not accepted', isRight(s('hablo', ['habló'])), false);
t('ñ counts as a diacritic', s('ano', ['año']), 'almost');
t('accents lenient for recall', s('cafe', ['café'], { ...ES, accents: 'lenient' }), 'accepted_accent');
t('subject pronoun may be dropped', s('Vivo en Tel Aviv.', ['Yo vivo en Tel Aviv.'], PRON), 'correct');
t('subject pronoun may be added', s('Yo vivo en Tel Aviv', ['Vivo en Tel Aviv.'], PRON), 'correct');
t('pronoun not optional where not configured', s('Vivo en Tel Aviv', ['Yo vivo en Tel Aviv.']), 'almost');
t('any listed alternative is right', s('sola', ['solo/a', 'solo', 'sola']), 'correct');
t('wrong word is wrong', s('Me acuesto a las siete', ['Me levanto a las siete']), 'almost');
t('unrelated is incorrect', s('Buenos días', ['Me levanto a las siete']), 'incorrect');
t('empty', s('   ', ['x']), 'empty');
const q = '¿Dónde vive Lucía?';
const C = { ...ES, match: 'content', accents: 'lenient' };
t('content: short answer', s('En Madrid', ['Vive en Madrid.'], C, q), 'correct');
t('content: full sentence', s('Lucía vive en Madrid.', ['Vive en Madrid.'], C, q), 'correct');
t('content: wrong city', s('Vive en Barcelona', ['Vive en Madrid.'], C, q), 'almost');
const fb = gradeText('Yo vivo en Barcelona hoy', ['Vivo en Madrid.'], ES).feedback;
t('feedback names extra words', JSON.stringify(fb).includes('barcelona'), true);
t('feedback counts missing words', fb.some(f => f.code === 'missing_words'), true);
t('word order feedback', gradeText('vives dónde', ['¿Dónde vives?'], ES).feedback[0].code, 'word_order');

t('single word near miss', gradeText('trabaja', ['trabajar'], ES).feedback[0].code, 'close_spelling');
t('single word unrelated', gradeText('comer', ['trabajar'], ES).feedback[0].code, 'wrong_word');
console.log('Other languages');
t('Arabic harakat ignored by default', s('كَتَبَ', ['كتب'], { harakat: 'ignore' }), 'correct');
t('Arabic tatweel ignored', s('كـتب', ['كتب'], { tatweel: 'ignore' }), 'correct');
t('Arabic hamza kept when alef strict', isRight(s('اكل', ['أكل'], { alef: 'strict', accents: 'strict' })), false);
t('Arabic alef lenient when configured', s('اكل', ['أكل'], { alef: 'lenient' }), 'correct');
t('Arabic punctuation ignored', s('ما اسمك؟', ['ما اسمك'], {}), 'correct');
t('German umlaut kept', isRight(s('schon', ['schön'], { accents: 'strict' })), false);
t('German ß lenient when configured', s('strasse', ['Straße'], { eszett: 'lenient' }), 'correct');
t('German case strict when configured', isRight(s('das haus', ['das Haus'], { case: 'strict', accents: 'strict' })), false);
t('Greek tonos strict', isRight(s('καλημερα', ['καλημέρα'], { accents: 'strict' })), false);
t('Greek question mark ignored', s('τι κάνεις;', ['Τι κάνεις'], {}), 'correct');
t('French apostrophe variants', s('l’école', ["l'école"], {}), 'correct');
t('normalize keeps letters', normalize('¡Hola, María!'), 'hola maría');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
