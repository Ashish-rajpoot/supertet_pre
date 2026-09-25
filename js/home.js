/* ===========================================================
   home.js - landing page: bank summary + quick start
   =========================================================== */

import { BASE, mountChrome } from './app.js';
import { ready, esc, toast } from './util.js';
import * as store from './store.js';
import { meta } from './data.js';
import { summary } from './analytics.js';
import { isLoggedIn, canAddQuestions } from './auth.js';

ready(async () => {
  mountChrome({ active: 'index.html' });

  const host = document.getElementById('bank');
  // Results and the Progress card are account-only; adding questions needs permission.
  const signedIn = isLoggedIn();
  const mayEdit = canAddQuestions();
  try {
    const m = await meta();
    const s = summary();
    const attempts = store.getAttempts();
    const last = attempts[attempts.length - 1];

    const subjects = m.subjects.length
      ? m.subjects.map(sub =>
          '<a class="row" href="' + BASE + 'pages/test.html?subject=' + encodeURIComponent(sub.subject) + '">' +
            '<span class="grow"><strong>' + esc(sub.subject) + '</strong>' +
            '<div class="muted small">' + sub.count + ' questions &middot; ' + sub.topics.length + ' topics</div></span>' +
            '<span class="pill brand">Test</span>' +
          '</a>').join('')
      : '<p class="muted">No questions yet.' + (mayEdit
          ? ' Open the <a href="' + BASE + 'pages/manage.html">Questions</a> page to upload an Excel or JSON file.'
          : ' The admin has not added a question bank yet.') + '</p>';

    host.innerHTML =
      '<div class="card">' +
        '<div class="stat-row">' +
          '<div class="stat"><div class="k">Questions</div><div class="v">' + m.total + '</div></div>' +
          '<div class="stat"><div class="k">Subjects</div><div class="v">' + m.subjects.length + '</div></div>' +
          (signedIn
            ? '<div class="stat"><div class="k">Tests taken</div><div class="v">' + s.attempts + '</div></div>' +
              '<div class="stat"><div class="k">Best score</div><div class="v">' + s.bestScore + '%</div></div>'
            : '<div class="stat" style="grid-column:1/-1"><div class="k">Your results</div>' +
              '<div class="v" style="font-size:15px">Log in to save tests and see your progress</div></div>') +
        '</div>' +
        (signedIn
          ? (last
              ? '<p class="small muted" style="margin:12px 0 0">Last test: <strong>' + esc(last.label) + '</strong> &middot; ' +
                last.score + '/' + last.total + ' (' + last.percent + '%) &middot; ' +
                '<a href="' + BASE + 'pages/result.html?id=' + encodeURIComponent(last.id) + '">open result</a></p>'
              : '<p class="small muted" style="margin:12px 0 0">No test taken yet. Start with flashcards, then try a test.</p>')
          : '') +
      '</div>' +
      '<div class="grid cols-3">' +
        '<a class="card" href="' + BASE + 'pages/flashcards.html" style="text-decoration:none;color:inherit">' +
          '<h3 style="margin-top:0">Flashcards</h3>' +
          '<p class="muted small" style="margin:0">Mobile friendly. Swipe right if you knew it, left to revise again.</p>' +
        '</a>' +
        '<a class="card" href="' + BASE + 'pages/test.html" style="text-decoration:none;color:inherit">' +
          '<h3 style="margin-top:0">Take a test</h3>' +
          '<p class="muted small" style="margin:0">Pick subjects and number of questions, with a timer and answer key.</p>' +
        '</a>' +
        (signedIn
          ? '<a class="card" href="' + BASE + 'pages/analytics.html" style="text-decoration:none;color:inherit">' +
            '<h3 style="margin-top:0">Progress</h3>' +
            '<p class="muted small" style="margin:0">Score trend, subject-wise accuracy and the topics needing revision.</p>' +
          '</a>'
          : '') +
      '</div>' +
      '<h2>Start with a subject</h2>' +
      '<div class="list">' + subjects + '</div>' +
      (mayEdit
        ? '<h2>For the site owner</h2>' +
          '<div class="list">' +
            '<a class="row" href="' + BASE + 'pages/manage.html"><span class="grow"><strong>Add questions (Excel / JSON)</strong>' +
              '<div class="muted small">Bulk upload, preview, validate and export the bank</div></span><span class="pill">Open</span></a>' +
          '</div>'
        : '');
  } catch (e) {
    host.innerHTML = '<div class="card"><h3>Could not load the question bank</h3><p class="muted small">' +
      esc(e.message) + '</p></div>';
    toast('Question bank failed to load');
  }
});
