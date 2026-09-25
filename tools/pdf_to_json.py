"""
pdf_to_json.py - build a question JSON file from the scanned SuperTET PDFs.

These PDFs use a legacy Hindi font, so some words come out slightly wrong
(for example "ववश्व" instead of "विश्व"). The script extracts everything it can
and writes the questions in the app's JSON format - please skim the output
before using it, and fix the odd word by hand.

Requirements:  pip install pypdf

Usage:
    python tools/pdf_to_json.py ../books/supertet-gk-gs.pdf
    python tools/pdf_to_json.py ../books/*.pdf --out data/from-pdf.json
    python tools/pdf_to_json.py ../books/supertet-child.pdf --subject "Child Development"
"""

import argparse
import glob
import json
import os
import re
import sys

try:
    from pypdf import PdfReader
except ImportError:  # pragma: no cover
    sys.exit('pypdf is required:  pip install pypdf')

LETTERS = ['A', 'B', 'C', 'D', 'E']

# page furniture (banners, watermarks, headings) - dropped before parsing
BANNER = re.compile(
    r'^(ONLINE CLASS|.*CHANDRA INSTITUTE|.*95\d{8,}|.*WHATSAPP|pUnzk|bykgkckn|ANSWER\s*[- ]?KEY|उत्तर)'
)
SKIP_EXACT = {
    'GK & GS', 'Reasoning', 'Hindi', 'Sanskrit', 'Child Development',
    'Geography', 'Science', 'IMPORTANT DAYS', 'सन्धिः',
}
DEVANAGARI = re.compile(r'[\u0900-\u097F]')
QNUM = re.compile(r'^\s*(\d{1,3})[.)]\s*(.+)$')

# options appear as "(a)" / "(A)" / "(क)" or "a)" / "A." - all three styles occur
OPT_PAREN = re.compile(r'\(([A-Ea-e\u0915-\u0919])\)\s*')
OPT_BARE = re.compile(r'(?<![A-Za-z0-9\u0915-\u0939])([A-Ea-e\u0915-\u0919])[).]\s*')
# answer keys look like "1. B", "12-B", "103) c" or "5. ख"
KEY_PAIR = re.compile(r'(\d{1,3})\s*[.\-)]\s*\(?([A-Ea-e\u0915-\u0919])\)?\b')

DEV_OPT = {'क': 'A', 'ख': 'B', 'ग': 'C', 'घ': 'D', 'ङ': 'E'}


def normalize_letter(ch):
    ch = ch.strip()
    return DEV_OPT.get(ch, ch.upper())

# best-effort repairs for the most frequent legacy-font mistakes
COMMON_FIXES = [
    ('वव', 'वि'), ('हह', 'हि'), ('धध', 'धि'), ('लल', 'लि'), ('लश', 'शि'),
    ('िा', 'दा'), ('पिा', 'पता'), ('इ ं', 'इं'), ('क े', 'के'), ('क ी', 'की'),
]


def fix_common(text):
    for bad, good in COMMON_FIXES:
        text = text.replace(bad, good)
    return text


def page_lines(reader, page_index):
    text = reader.pages[page_index].extract_text() or ''
    out = []
    for line in text.splitlines():
        line = ' '.join(line.split())
        if not line:
            continue
        if BANNER.match(line) or line in SKIP_EXACT:
            continue
        if 'baLVhV~;wV' in line:
            continue
        # a row of the answer key ("1. B 11. B 21. B ...") is not a question
        if len(KEY_PAIR.findall(line)) >= 3:
            continue
        out.append(line)
    return out


def read_answer_key(reader):
    """Collect '12. B' style pairs from every page."""
    keys = {}
    for i in range(len(reader.pages)):
        text = reader.pages[i].extract_text() or ''
        for num, letter in KEY_PAIR.findall(text):
            keys.setdefault(int(num), normalize_letter(letter))
    return keys


def split_blocks(lines):
    """Group lines into {question number: [lines]} using the leading numbers."""
    blocks, current, num = {}, None, None
    for line in lines:
        m = QNUM.match(line)
        if m:
            if current is not None:
                blocks[num] = current
            num = int(m.group(1))
            current = [m.group(2)]
        elif current is not None:
            current.append(line)
    if current is not None:
        blocks[num] = current
    return blocks


def parse_block(lines):
    """Return (q_hi, opts_hi, q_en, opts_en) for one question block."""
    hi_lines, en_lines = [], []
    for line in lines:
        (hi_lines if DEVANAGARI.search(line) else en_lines).append(line)

    def harvest(text_lines):
        joined = ' '.join(text_lines)
        # prefer (a)-style markers when they are present, else fall back to a) / a.
        marks = list(OPT_PAREN.finditer(joined))
        if len(marks) < 2:
            marks = list(OPT_BARE.finditer(joined))
        if len(marks) < 2:
            return joined.strip(), []
        stem = joined[:marks[0].start()].strip()
        opts = []
        for i, mk in enumerate(marks):
            start = mk.end()
            end = marks[i + 1].start() if i + 1 < len(marks) else len(joined)
            opts.append(' '.join(joined[start:end].split()).strip(' .'))
        return stem, opts

    q_hi, o_hi = harvest(hi_lines)
    q_en, o_en = harvest(en_lines)
    while o_hi and not o_hi[-1]:
        o_hi.pop()
    while o_en and not o_en[-1]:
        o_en.pop()
    return q_hi, o_hi, q_en, o_en


def slug(text):
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-') or 'pdf'


DEFAULT_SUBJECTS = {
    'gk-gs': 'GK & GS',
    'child': 'Child Development',
    'geography': 'Geography',
    'science': 'Science',
    'hindi': 'Hindi',
    'sanskrit': 'Sanskrit',
    'reasoning': 'Reasoning',
}


def subject_from_filename(path):
    stem = os.path.splitext(os.path.basename(path))[0].replace('supertet-', '')
    return DEFAULT_SUBJECTS.get(stem, stem.replace('-', ' ').title())


def convert_pdf(path, subject, allow_missing_answers=False):
    reader = PdfReader(path)
    keys = read_answer_key(reader)
    lines = []
    for i in range(len(reader.pages)):
        lines.extend(page_lines(reader, i))
    blocks = split_blocks(lines)

    questions, problems = [], []
    for number in sorted(blocks):
        q_hi, o_hi, q_en, o_en = parse_block(blocks[number])
        if not (q_hi or q_en):
            continue
        if len(o_hi) < 2 and len(o_en) < 2:
            problems.append('%s: Q%d has too few options' % (os.path.basename(path), number))
            continue
        answer = keys.get(number, '')
        if not answer and not allow_missing_answers:
            problems.append('%s: Q%d missing from the answer key' % (os.path.basename(path), number))
            continue
        if not o_en:
            o_en = list(o_hi)
        if not o_hi:
            o_hi = list(o_en)
        questions.append({
            'id': '%s-%d' % (slug(subject), number),
            'subject': subject,
            'topic': 'General',
            'difficulty': 'medium',
            'question': {'hi': q_hi, 'en': q_en},
            'options': {'hi': o_hi, 'en': o_en},
            'answer': answer,
            'explanation': {'hi': '', 'en': ''},
            'tags': ['from-pdf'] + ([] if answer else ['needs-answer']),
        })
    return questions, problems


def main():
    ap = argparse.ArgumentParser(description='Extract questions from the SuperTET PDFs.')
    ap.add_argument('inputs', nargs='+', help='one or more PDF paths (globs allowed)')
    ap.add_argument('--out', default=None, help='output json path (default: data/from-pdf.json)')
    ap.add_argument('--subject', default=None, help='override the subject name for all inputs')
    ap.add_argument('--fix', action='store_true', help='apply best-effort legacy-font fixes to Hindi text')
    ap.add_argument('--allow-missing-answers', action='store_true',
                    help='still export questions whose answer was not in the answer key (tagged "needs-answer")')
    args = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
    out = args.out or os.path.join(root, 'data', 'from-pdf.json')

    paths = []
    for pattern in args.inputs:
        found = glob.glob(pattern)
        paths.extend(found or [pattern])

    all_q, all_problems = [], []
    for path in paths:
        if not os.path.exists(path):
            print('missing:', path)
            continue
        subject = args.subject or subject_from_filename(path)
        qs, problems = convert_pdf(path, subject, args.allow_missing_answers)
        if args.fix:
            for q in qs:
                q['question']['hi'] = fix_common(q['question']['hi'])
                q['options']['hi'] = [fix_common(o) for o in q['options']['hi']]
        all_q.extend(qs)
        all_problems.extend(problems)
        print('%-28s %3d questions, %d warnings' % (os.path.basename(path), len(qs), len(problems)))

    with open(out, 'w', encoding='utf-8') as f:
        json.dump(all_q, f, ensure_ascii=False, indent=2)

    no_answer = sum(1 for q in all_q if not q['answer'])
    print('\nwrote %d question(s) to %s' % (len(all_q), out))
    if no_answer:
        print('%d of them still need an answer (tagged "needs-answer") - please fill those in.' % no_answer)
    print('Please review the Hindi text - the PDF uses a legacy font, so some words need fixing by hand.')
    if all_problems:
        print('\nwarnings (first 15):')
        for p in all_problems[:15]:
            print('  -', p)

    try:
        shown = os.path.relpath(out, root)
    except ValueError:      # output on another drive (e.g. a temp folder)
        shown = out
    print('\nNext steps:')
    print('  1. Correct any wrong Hindi words in %s' % shown)
    print('  2. Split it per subject if you like, then list the files in data/index.json')


if __name__ == '__main__':
    main()

