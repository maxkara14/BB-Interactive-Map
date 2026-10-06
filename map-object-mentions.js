// Expand known noun paradigms, keeping adjective agreement and exact word boundaries.
// Unknown and compound labels retain exact matching rather than guessed stems.
const nouns = new Map();
const register = (singular, plural) => {
    const paradigm = { singular: singular.split(' '), plural: plural.split(' ') };
    for (const form of [...paradigm.singular, ...paradigm.plural]) {
        nouns.set(form, paradigm);
        nouns.set(form.replaceAll('ё', 'е'), paradigm);
    }
};
for (const word of ['стол', 'шкаф', 'диван', 'телефон', 'меч', 'щит', 'топор', 'колун', 'рюкзак', 'блокнот', 'карандаш', 'портрет', 'конверт', 'браслет', 'амулет', 'поднос', 'сундук']) {
    const pluralEnding = /[гкхжчшщ]$/u.test(word) ? 'и' : 'ы';
    const genitiveEnding = /[жчшщ]$/u.test(word) ? 'ей' : 'ов';
    register(`${word} ${word}а ${word}у ${word} ${word}ом ${word}е`,
        `${word}${pluralEnding} ${word}${genitiveEnding} ${word}ам ${word}${pluralEnding} ${word}ами ${word}ах`);
}
register('ключ ключа ключу ключ ключом ключе', 'ключи ключей ключам ключи ключами ключах');
register('стул стула стулу стул стулом стуле', 'стулья стульев стульям стулья стульями стульях');
register('замок замка замку замок замком замке', 'замки замков замкам замки замками замках');
register('нож ножа ножу нож ножом ноже', 'ножи ножей ножам ножи ножами ножах');
register('фонарь фонаря фонарю фонарь фонарём фонаре', 'фонари фонарей фонарям фонари фонарями фонарях');
register('камень камня камню камень камнем камне', 'камни камней камням камни камнями камнях');
register('окно окна окну окно окном окне', 'окна окон окнам окна окнами окнах');
register('зеркало зеркала зеркалу зеркало зеркалом зеркале', 'зеркала зеркал зеркалам зеркала зеркалами зеркалах');
register('письмо письма письму письмо письмом письме', 'письма писем письмам письма письмами письмах');
register('полотенце полотенца полотенцу полотенце полотенцем полотенце', 'полотенца полотенец полотенцам полотенца полотенцами полотенцах');
register('кольцо кольца кольцу кольцо кольцом кольце', 'кольца колец кольцам кольца кольцами кольцах');
register('ружьё ружья ружью ружьё ружьём ружье', 'ружья ружей ружьям ружья ружьями ружьях');
register('копьё копья копью копьё копьём копье', 'копья копий копьям копья копьями копьях');
register('дверь двери двери дверь дверью двери', 'двери дверей дверям двери дверями дверях');
register('кровать кровати кровати кровать кроватью кровати', 'кровати кроватей кроватям кровати кроватями кроватях');
register('тетрадь тетради тетради тетрадь тетрадью тетради', 'тетради тетрадей тетрадям тетради тетрадями тетрадях');
register('доска доски доске доску доской доске', 'доски досок доскам доски досками досках');
register('ручка ручки ручке ручку ручкой ручке', 'ручки ручек ручкам ручки ручками ручках');
register('книга книги книге книгу книгой книге', 'книги книг книгам книги книгами книгах');
register('бутылка бутылки бутылке бутылку бутылкой бутылке', 'бутылки бутылок бутылкам бутылки бутылками бутылках');
register('чашка чашки чашке чашку чашкой чашке', 'чашки чашек чашкам чашки чашками чашках');
register('ложка ложки ложке ложку ложкой ложке', 'ложки ложек ложкам ложки ложками ложках');
register('тарелка тарелки тарелке тарелку тарелкой тарелке', 'тарелки тарелок тарелкам тарелки тарелками тарелках');
register('бумага бумаги бумаге бумагу бумагой бумаге', 'бумаги бумаг бумагам бумаги бумагами бумагах');
register('сумка сумки сумке сумку сумкой сумке', 'сумки сумок сумкам сумки сумками сумках');
register('парта парты парте парту партой парте', 'парты парт партам парты партами партах');
register('полка полки полке полку полкой полке', 'полки полок полкам полки полками полках');
register('половица половицы половице половицу половицей половице', 'половицы половиц половицам половицы половицами половицах');

const endings = {
    hard: {
        male: ['ый', 'ого', 'ому', 'ый', 'ым', 'ом'],
        female: ['ая', 'ой', 'ой', 'ую', 'ой', 'ой'],
        neuter: ['ое', 'ого', 'ому', 'ое', 'ым', 'ом'],
        plural: ['ые', 'ых', 'ым', 'ые', 'ыми', 'ых'],
    },
    soft: {
        male: ['ий', 'его', 'ему', 'ий', 'им', 'ем'],
        female: ['яя', 'ей', 'ей', 'юю', 'ей', 'ей'],
        neuter: ['ее', 'его', 'ему', 'ее', 'им', 'ем'],
        plural: ['ие', 'их', 'им', 'ие', 'ими', 'их'],
    },
};

function adjective(word) {
    const stem = word.slice(0, -2), ending = word.slice(-2);
    if (!/^[а-яё]+$/u.test(stem) || !['ый', 'ой', 'ая', 'ое', 'ые', 'ий', 'яя', 'ее', 'ие'].includes(ending)) return null;
    const soft = ['яя', 'ее'].includes(ending) || (['ий', 'ие'].includes(ending) && !/[гкхжчшщ]$/u.test(stem));
    const table = soft ? endings.soft : endings.hard;
    const spelling = /[гкхжчшщ]$/u.test(stem);
    const forms = (gender, plural) => table[plural ? 'plural' : gender].map((suffix, index) => {
        if (!soft && spelling) suffix = suffix.replace(/^ы/u, 'и');
        if (!plural && gender === 'male' && (index === 0 || index === 3)
            && ['ый', 'ой', 'ий'].includes(ending)) suffix = ending;
        return stem + suffix;
    });
    return forms;
}

export function objectMentionAliases(name) {
    const words = name.toLowerCase().trim().split(/[\s\u3164\uFFA0\u2800\u200B]+/u);
    const noun = words.at(-1);
    const paradigm = nouns.get(noun);
    // Only a nominative noun with zero or more adjectives has a reliable short label.
    if (!paradigm || ![paradigm.singular[0], paradigm.plural[0]].some(form => noun.replaceAll('ё', 'е') === form.replaceAll('ё', 'е'))) return [];
    const modifiers = words.slice(0, -1).map(adjective);
    if (modifiers.some(value => !value)) return [];
    const gender = /[ая]$/u.test(paradigm.singular[0]) || ['дверь', 'кровать', 'тетрадь'].includes(paradigm.singular[0])
        ? 'female' : /[оеё]$/u.test(paradigm.singular[0]) ? 'neuter' : 'male';
    const aliases = new Set();
    for (const plural of [false, true]) {
        const nounForms = plural ? paradigm.plural : paradigm.singular;
        const adjectiveForms = modifiers.map(modifier => modifier(gender, plural));
        for (let i = 0; i < nounForms.length; i++) {
            aliases.add([...adjectiveForms.map(forms => forms[i]), nounForms[i]].join(' '));
            aliases.add(nounForms[i]);
        }
    }
    for (const alias of [...aliases]) if (alias.includes('ё')) aliases.add(alias.replaceAll('ё', 'е'));
    return [...aliases];
}

export function objectMentionBlockers(name) {
    if (objectMentionAliases(name).length) return [];
    // A compound label can still make another object's short noun ambiguous.
    const forms = new Set();
    for (const word of name.toLowerCase().split(/[\s\u3164\uFFA0\u2800\u200B]+/u)) {
        const paradigm = nouns.get(word);
        if (paradigm) for (const form of [...paradigm.singular, ...paradigm.plural]) forms.add(form);
    }
    return [...forms];
}
