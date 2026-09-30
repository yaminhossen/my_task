'use strict';

/* ---------- Helpers ---------- */

function newId() {
  if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

const pad = n => String(n).padStart(2, '0');

function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// 'YYYY-MM-DD' -> local Date (not UTC, so the day never shifts).
function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function isISODate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(parseISO(value));
}

function longDate(iso) {
  return parseISO(iso).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// Group heading on the home page: Today / Yesterday / Tomorrow / a short date.
function groupLabel(iso) {
  const days = Math.round((parseISO(iso) - parseISO(todayISO())) / 86400000);
  if (days === 0) return 'Today';
  if (days === -1) return 'Yesterday';
  if (days === 1) return 'Tomorrow';
  const date = parseISO(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' });
}

function plural(n, word) {
  return n + ' ' + word + (n === 1 ? '' : 's');
}

/* ---------- Storage layer: the only place that touches localStorage ---------- */

function isValidTask(t) {
  return t !== null && typeof t === 'object' &&
    typeof t.id === 'string' &&
    typeof t.text === 'string' && t.text.trim() !== '' &&
    typeof t.completed === 'boolean' &&
    Number.isFinite(t.order) &&
    (t.completedOrder === null || Number.isFinite(t.completedOrder));
}

function isValidList(l) {
  return l !== null && typeof l === 'object' &&
    typeof l.id === 'string' &&
    typeof l.title === 'string' && l.title.trim() !== '' &&
    isISODate(l.date) &&
    Number.isFinite(l.order) &&
    Array.isArray(l.tasks);
}

const Store = {
  KEY: 'simple-notes.data.v2',
  LEGACY_KEY: 'simple-notes.tasks.v1', // single-list format from the first version

  load() {
    let raw;
    try {
      raw = localStorage.getItem(this.KEY);
    } catch (err) {
      console.warn('localStorage is unavailable:', err);
      return [];
    }
    if (raw === null) return this.migrateLegacy();

    try {
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.lists)) throw new Error('Saved data has no lists');
      return data.lists.filter(isValidList).map(l => ({ ...l, tasks: l.tasks.filter(isValidTask) }));
    } catch (err) {
      // Keep the unreadable data aside so it is not silently lost, then start fresh.
      console.warn('Saved data was corrupted and has been reset:', err);
      try {
        localStorage.setItem(this.KEY + '.corrupt-backup', raw);
      } catch (_) { /* ignore */ }
      return [];
    }
  },

  // Tasks saved by the single-list version become the first list, "My Tasks".
  migrateLegacy() {
    let tasks = [];
    try {
      const old = JSON.parse(localStorage.getItem(this.LEGACY_KEY));
      if (Array.isArray(old)) tasks = old.filter(isValidTask);
    } catch (_) {
      return [];
    }
    if (tasks.length === 0) return [];
    const lists = [{ id: newId(), title: 'My Tasks', date: todayISO(), order: 1, tasks }];
    this.save(lists);
    return lists;
  },

  save(lists) {
    try {
      localStorage.setItem(this.KEY, JSON.stringify({ version: 2, lists }));
      return true;
    } catch (err) {
      console.error('Could not save:', err);
      alert('Could not save your notes. Device storage may be full.');
      return false;
    }
  }
};

/* ---------- State ---------- */

// lists: [{ id, title, date: 'YYYY-MM-DD', order, tasks: [...] }]
// task:  { id, text, completed, order, completedOrder }
//   order          - creation order; unchecked tasks sort by this
//   completedOrder - when it was checked; checked tasks sort by this (last checked = last)
let lists = Store.load();
let currentListId = null; // null = home page

function currentList() {
  return lists.find(l => l.id === currentListId) || null;
}

function commit() {
  Store.save(lists);
  render();
}

/* ---------- List operations ---------- */

function addList(title, date) {
  const list = { id: newId(), title, date, order: Math.max(0, ...lists.map(l => l.order)) + 1, tasks: [] };
  lists.push(list);
  commit();
  return list;
}

function updateList(id, title, date) {
  const list = lists.find(l => l.id === id);
  if (!list) return;
  list.title = title;
  list.date = date;
  commit();
}

function deleteList(id) {
  lists = lists.filter(l => l.id !== id);
  commit();
}

/* ---------- Task operations (on the open list) ---------- */

// The most recent task change, so the next render can animate that one row.
let lastChange = null;

function nextSequence(tasks) {
  let max = 0;
  for (const t of tasks) max = Math.max(max, t.order, t.completedOrder || 0);
  return max + 1;
}

function sortedTasks(tasks) {
  const open = tasks.filter(t => !t.completed).sort((a, b) => a.order - b.order);
  const done = tasks.filter(t => t.completed).sort((a, b) => a.completedOrder - b.completedOrder);
  return open.concat(done);
}

function addTask(text) {
  const list = currentList();
  if (!list) return;
  const task = { id: newId(), text, completed: false, order: nextSequence(list.tasks), completedOrder: null };
  list.tasks.push(task);
  lastChange = { id: task.id, type: 'added' };
  commit();
}

function editTask(id, text) {
  const task = currentList() && currentList().tasks.find(t => t.id === id);
  if (!task) return;
  task.text = text;
  commit();
}

function setCompleted(id, completed) {
  const list = currentList();
  const task = list && list.tasks.find(t => t.id === id);
  if (!task) return;
  task.completed = completed;
  task.completedOrder = completed ? nextSequence(list.tasks) : null;
  lastChange = { id, type: completed ? 'checked' : 'unchecked' };
  haptic(completed ? 10 : 6);
  commit();
}

function deleteTask(id) {
  const list = currentList();
  if (!list) return;
  list.tasks = list.tasks.filter(t => t.id !== id);
  commit();
}

/* ---------- Rendering ---------- */

const $ = id => document.getElementById(id);
const homeView = $('home-view');
const listView = $('list-view');
const homeGroupsEl = $('home-groups');
const homeEmptyEl = $('home-empty');
const openListEl = $('open-list');
const doneListEl = $('done-list');
const doneSectionEl = $('done-section');
const emptyEl = $('empty-state');
const backButton = $('back-button');
const editListButton = $('edit-list-button');
const addButton = $('add-button');

const EDIT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>';
const DELETE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
const CHEVRON_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

function setHero({ title, date, summary, done, total }) {
  $('hero-title').textContent = title;
  $('hero-date').textContent = date;
  $('summary').textContent = summary;
  $('progress-count').textContent = total ? done + ' / ' + total : '';
  $('progress-bar').style.width = total ? (done / total * 100) + '%' : '0';
}

function render() {
  const list = currentList();
  homeView.hidden = !!list;
  listView.hidden = !list;
  backButton.hidden = !list;
  editListButton.hidden = !list;
  addButton.setAttribute('aria-label', list ? 'Add task' : 'New list');
  document.title = list ? list.title + ' · Simple Notes' : 'Simple Notes';
  if (list) renderList(list);
  else renderHome();
  lastChange = null;
}

function renderHome() {
  const allTasks = lists.flatMap(l => l.tasks);
  const done = allTasks.filter(t => t.completed).length;
  const left = allTasks.length - done;
  setHero({
    title: 'Simple Notes',
    date: longDate(todayISO()),
    summary: lists.length === 0 ? 'No lists yet'
      : plural(lists.length, 'list') + (allTasks.length ? ' · ' + (left ? plural(left, 'task') + ' left' : 'all done') : ''),
    done,
    total: allTasks.length
  });

  // Newest date first; within a date, newest list first.
  const sorted = [...lists].sort((a, b) => b.date.localeCompare(a.date) || b.order - a.order);
  const groups = [];
  for (const list of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.date === list.date) last.lists.push(list);
    else groups.push({ date: list.date, lists: [list] });
  }

  homeGroupsEl.replaceChildren(...groups.map(group => {
    const section = document.createElement('section');
    section.className = 'date-group';
    const heading = document.createElement('h2');
    heading.className = 'section-title';
    heading.textContent = groupLabel(group.date);
    const ul = document.createElement('ul');
    ul.className = 'card-list';
    ul.append(...group.lists.map(renderListCard));
    section.append(heading, ul);
    return section;
  }));
  homeEmptyEl.hidden = lists.length > 0;
}

function renderListCard(list) {
  const total = list.tasks.length;
  const done = list.tasks.filter(t => t.completed).length;

  const li = document.createElement('li');
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'list-card' + (total && done === total ? ' all-done' : '');
  card.dataset.id = list.id;

  const row = document.createElement('span');
  row.className = 'list-card-row';
  const title = document.createElement('span');
  title.className = 'list-card-title';
  title.textContent = list.title;
  const count = document.createElement('span');
  count.className = 'list-card-count';
  count.textContent = total ? done + '/' + total : '';
  const chevron = document.createElement('span');
  chevron.className = 'list-card-chevron';
  chevron.innerHTML = CHEVRON_ICON;
  row.append(title, count, chevron);

  const meta = document.createElement('span');
  meta.className = 'list-card-meta';
  meta.textContent = total === 0 ? 'No tasks yet'
    : done === total ? 'All done'
    : plural(total - done, 'task') + ' left';

  const bar = document.createElement('span');
  bar.className = 'mini-progress';
  const fill = document.createElement('span');
  fill.style.width = total ? (done / total * 100) + '%' : '0';
  bar.append(fill);

  card.append(row, meta, bar);
  li.append(card);
  return li;
}

function renderList(list) {
  const sorted = sortedTasks(list.tasks);
  const open = sorted.filter(t => !t.completed);
  const done = sorted.filter(t => t.completed);

  setHero({
    title: list.title,
    date: longDate(list.date),
    summary: list.tasks.length === 0 ? 'No tasks yet'
      : open.length === 0 ? 'All tasks done'
      : plural(open.length, 'task') + ' remaining',
    done: done.length,
    total: list.tasks.length
  });

  openListEl.replaceChildren(...open.map(renderTask));
  doneListEl.replaceChildren(...done.map(renderTask));
  doneSectionEl.hidden = done.length === 0;
  $('done-count').textContent = done.length;
  emptyEl.hidden = list.tasks.length > 0;
}

function renderTask(task) {
  const li = document.createElement('li');
  li.className = 'task' + (task.completed ? ' done' : '');
  if (lastChange && lastChange.id === task.id) li.classList.add('anim-' + lastChange.type);
  li.dataset.id = task.id;

  const label = document.createElement('label');
  label.className = 'task-check';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = task.completed;
  checkbox.setAttribute('aria-label', 'Mark "' + task.text + '" as done');
  label.append(checkbox);

  const text = document.createElement('span');
  text.className = 'task-text';
  text.textContent = task.text;

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'icon-btn edit';
  editBtn.innerHTML = EDIT_ICON;
  editBtn.setAttribute('aria-label', 'Edit task');

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'icon-btn delete';
  deleteBtn.innerHTML = DELETE_ICON;
  deleteBtn.setAttribute('aria-label', 'Delete task');

  li.append(label, text, editBtn, deleteBtn);
  return li;
}

/* ---------- Navigation (hash based, so the Android back button works) ---------- */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let cameFromHome = false;
let homeScroll = 0;

function listIdFromHash() {
  const match = location.hash.match(/^#\/list\/(.+)$/);
  const id = match ? decodeURIComponent(match[1]) : null;
  return id && lists.some(l => l.id === id) ? id : null;
}

// Switch views with a soft sliding page transition where supported.
function showView(id, direction) {
  if (currentListId === null && id !== null) homeScroll = window.scrollY;
  currentListId = id;
  const update = () => {
    render();
    window.scrollTo(0, id ? 0 : homeScroll);
  };
  if (!document.startViewTransition || reduceMotion.matches) {
    update();
    return;
  }
  document.documentElement.dataset.nav = direction;
  document.startViewTransition(update).finished.finally(() => {
    delete document.documentElement.dataset.nav;
  });
}

function openList(id) {
  cameFromHome = true;
  location.hash = '#/list/' + encodeURIComponent(id);
}

function goHome() {
  if (cameFromHome) history.back();
  else location.hash = '#/';
}

window.addEventListener('hashchange', () => {
  const id = listIdFromHash();
  if (id === currentListId) return;
  if (id === null) cameFromHome = false;
  showView(id, id ? 'forward' : 'back');
});

backButton.addEventListener('click', goHome);

homeGroupsEl.addEventListener('click', e => {
  const card = e.target.closest('.list-card');
  if (card) openList(card.dataset.id);
});

/* ---------- Task list interactions ---------- */

listView.addEventListener('change', e => {
  if (e.target.type !== 'checkbox') return;
  setCompleted(e.target.closest('.task').dataset.id, e.target.checked);
});

listView.addEventListener('click', e => {
  const item = e.target.closest('.task');
  if (!item) return;
  const task = currentList() && currentList().tasks.find(t => t.id === item.dataset.id);
  if (!task) return;

  if (e.target.closest('.delete')) {
    if (confirm('Delete "' + task.text + '"?')) deleteTask(task.id);
  } else if (e.target.closest('.edit') || e.target.closest('.task-text')) {
    openTaskSheet(task, item);
  }
});

/* ---------- Bottom sheets with a shared-element zoom transition ----------
   A sheet grows out of the tapped element (the + button, a task row, the edit
   button) and shrinks back into it, like iOS zoom transitions. A clip-path
   window the size of the source expands to the full sheet while a copy of the
   source's look (.morph-fill) fades away to reveal the sheet content. */

const MORPH_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'; // iOS sheet curve

function createSheet(dialog) {
  const form = dialog.querySelector('form');
  const fill = dialog.querySelector('.morph-fill');
  let source = null;
  let animations = [];
  let closing = false;
  const hidden = new Set();

  function frames(el) {
    const d = dialog.getBoundingClientRect();
    const s = el.getBoundingClientRect();
    const insetY = Math.max(0, (d.height - s.height) / 2);
    const insetX = Math.max(0, (d.width - s.width) / 2);
    const dx = (s.left + s.width / 2) - (d.left + d.width / 2);
    const dy = (s.top + s.height / 2) - (d.top + d.height / 2);
    return [
      {
        transform: `translate(${dx}px, ${dy}px)`,
        clipPath: `inset(${insetY}px ${insetX}px round ${getComputedStyle(el).borderRadius})`
      },
      {
        transform: 'translate(0px, 0px)',
        clipPath: `inset(0px 0px round ${getComputedStyle(dialog).borderRadius})`
      }
    ];
  }

  // Paint the fill to look like the source element (its background and icon).
  function dressFill(el) {
    const style = getComputedStyle(el);
    fill.style.backgroundColor = style.backgroundColor;
    fill.style.backgroundImage = style.backgroundImage;
    fill.style.color = style.color;
    const icon = el.querySelector(':scope > svg');
    fill.replaceChildren(...(icon ? [icon.cloneNode(true)] : []));
  }

  function hide(el) {
    el.style.visibility = 'hidden';
    hidden.add(el);
  }

  function stop() {
    animations.forEach(a => a.cancel());
    animations = [];
  }

  function open(sourceEl) {
    dialog.showModal();
    stop();
    source = sourceEl || null;
    if (!source || reduceMotion.matches) return;

    dressFill(source);
    hide(source); // the element "becomes" the sheet
    const timing = { duration: 600, easing: MORPH_EASE };
    animations = [
      dialog.animate(frames(source), timing),
      form.animate([{ transform: 'scale(0.94)', opacity: 0 }, { transform: 'none', opacity: 1 }], timing),
      fill.animate([{ opacity: 1 }, { opacity: 1, offset: 0.1 }, { opacity: 0 }], { duration: 460, easing: 'ease-out' }),
      dialog.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 450, pseudoElement: '::backdrop' })
    ];
  }

  function close(after) {
    if (!dialog.open || closing) return;
    const done = () => {
      dialog.close();
      if (after) after();
    };

    // A re-rendered row is a new element; find its replacement by id.
    let target = source;
    if (target && !target.isConnected && target.dataset.id) {
      target = document.querySelector('.' + target.classList[0] + '[data-id="' + CSS.escape(target.dataset.id) + '"]');
    }
    const visible = target && target.isConnected && target.getClientRects().length > 0;
    if (!visible || reduceMotion.matches) {
      done();
      return;
    }

    closing = true;
    stop();
    dressFill(target);
    hide(target);
    const timing = { duration: 500, easing: MORPH_EASE, fill: 'forwards' };
    animations = [
      dialog.animate(frames(target).reverse(), timing),
      form.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' }),
      fill.animate([{ opacity: 0 }, { opacity: 1, offset: 0.55 }, { opacity: 1 }], timing),
      dialog.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 460, fill: 'forwards', pseudoElement: '::backdrop' })
    ];
    animations[0].finished.then(done, done);
  }

  // However the sheet ends up closed, reset the transition state.
  dialog.addEventListener('close', () => {
    stop();
    closing = false;
    hidden.forEach(el => { el.style.visibility = ''; });
    hidden.clear();
    source = null;
  });

  // Escape key / Android back button: animate instead of closing instantly.
  dialog.addEventListener('cancel', e => {
    e.preventDefault();
    close();
  });

  // Tapping the dimmed backdrop, or a Cancel button, closes the sheet.
  dialog.addEventListener('click', e => {
    if (e.target === dialog || e.target.closest('[data-close]')) close();
  });

  return { open, close };
}

/* ---------- List sheet (title + date) ---------- */

const listSheet = createSheet($('list-dialog'));
const listTitleInput = $('list-title-input');
const listDateInput = $('list-date-input');
const listErrorEl = $('list-error');
const deleteListButton = $('delete-list-button');
let editingListId = null;

function openListSheet(list, sourceEl) {
  editingListId = list ? list.id : null;
  $('list-dialog-title').textContent = list ? 'Edit List' : 'New List';
  listTitleInput.value = list ? list.title : '';
  listDateInput.value = list ? list.date : todayISO();
  listErrorEl.hidden = true;
  deleteListButton.hidden = !list;
  listSheet.open(sourceEl);
  listTitleInput.focus();
}

$('list-form').addEventListener('submit', e => {
  e.preventDefault();
  const title = listTitleInput.value.trim();
  const date = listDateInput.value;
  const problem = !title ? 'Please enter a title.' : !isISODate(date) ? 'Please pick a date.' : '';
  if (problem) {
    listErrorEl.textContent = problem;
    listErrorEl.hidden = false;
    (title ? listDateInput : listTitleInput).focus();
    return;
  }
  if (editingListId) {
    updateList(editingListId, title, date);
    listSheet.close();
  } else {
    const list = addList(title, date);
    listSheet.close(() => openList(list.id));
  }
});

[listTitleInput, listDateInput].forEach(el => el.addEventListener('input', () => { listErrorEl.hidden = true; }));

deleteListButton.addEventListener('click', () => {
  const list = lists.find(l => l.id === editingListId);
  if (!list || !confirm('Delete "' + list.title + '" and all of its tasks?')) return;
  listSheet.close(() => {
    deleteList(list.id);
    goHome();
  });
});

editListButton.addEventListener('click', () => openListSheet(currentList(), editListButton));

/* ---------- Task sheet ---------- */

const taskSheet = createSheet($('task-dialog'));
const taskInput = $('task-input');
const taskErrorEl = $('task-error');
let editingTaskId = null;

function openTaskSheet(task, sourceEl) {
  editingTaskId = task ? task.id : null;
  $('dialog-title').textContent = task ? 'Edit Task' : 'New Task';
  taskInput.value = task ? task.text : '';
  taskErrorEl.hidden = true;
  taskSheet.open(sourceEl);
  taskInput.focus();
}

$('task-form').addEventListener('submit', e => {
  e.preventDefault();
  const text = taskInput.value.trim();
  if (!text) {
    taskErrorEl.hidden = false;
    taskInput.focus();
    return;
  }
  if (editingTaskId) editTask(editingTaskId, text);
  else addTask(text);
  taskSheet.close();
});

taskInput.addEventListener('input', () => { taskErrorEl.hidden = true; });

// The + button creates a list on the home page and a task inside a list.
addButton.addEventListener('click', () => {
  haptic(8);
  if (currentList()) openTaskSheet(null, addButton);
  else openListSheet(null, addButton);
});

/* ---------- Touch feedback ---------- */

// Short vibration on Android; silently ignored where unsupported.
function haptic(ms) {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch (_) { /* ignore */ }
}

// Soft ripple from the touch point on any .ripple button.
document.addEventListener('pointerdown', e => {
  const target = e.target.closest('.ripple');
  if (!target) return;
  const rect = target.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 2;
  const wave = document.createElement('span');
  wave.className = 'ripple-wave';
  wave.style.width = wave.style.height = size + 'px';
  wave.style.left = (e.clientX - rect.left - size / 2) + 'px';
  wave.style.top = (e.clientY - rect.top - size / 2) + 'px';
  target.append(wave);
  wave.addEventListener('animationend', () => wave.remove());
  setTimeout(() => wave.remove(), 1000); // fallback when animations are disabled
});

/* ---------- Start up ---------- */

currentListId = listIdFromHash();
render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

// Ask the browser not to evict our data under storage pressure (best effort).
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}
