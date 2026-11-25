'use strict';

const STORAGE_KEY = 'rashody.expenses.v1';
const BUDGET_STORAGE_KEY = 'rashody.budgets.v1';
const categories = ['Еда', 'Транспорт', 'Дом', 'покупки'];
const necessityLabels = new Map([['required', 'Обязательная'], ['optional', 'Необязательная']]);
const regularityLabels = new Map([['regular', 'Регулярная'], ['irregular', 'Нерегулярная']]);
const get = (id) => document.getElementById(id);
const form = get('expense-form');
const amountInput = get('amount');
const dateInput = get('date');
const necessityInput = get('necessity');
const regularityInput = get('regularity');
const fromInput = get('period-from');
const toInput = get('period-to');
const presets = [...document.querySelectorAll('[data-period]')];
let expenses = [];
let activePeriod = 'all';
let budgets = {};
let budgetMonth = '';
let budgetReadFailed = false;
let expensesReadFailed = false;
let budgetRows = [];

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && localDate(date) === value;
}

function parseAmount(value) {
  const trimmed = value.trim();
  if (!/^(?:\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)$/.test(trimmed)) return null;
  const number = Number(trimmed.replace(/[ \u00a0\u202f]/g, ''));
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function money(value) {
  return `${String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₸`;
}

function loadBudgets() {
  try {
    const saved = localStorage.getItem(BUDGET_STORAGE_KEY);
    if (saved === null) return;
    const parsed = JSON.parse(saved);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || !Object.entries(parsed).every(([month, limits]) => validDate(`${month}-01`)
        && limits && typeof limits === 'object' && !Array.isArray(limits)
        && Object.entries(limits).every(([category, amount]) => categories.includes(category)
          && Number.isSafeInteger(amount) && amount >= 0))) {
      throw new Error('Invalid saved budgets');
    }
    budgets = parsed;
  } catch {
    budgetReadFailed = true;
    get('budget-storage-status').textContent = 'Не удалось прочитать лимиты. Данные не перезаписаны. Проверь доступ к хранилищу и обнови страницу.';
  }
}

function renderBudgets() {
  const month = localDate().slice(0, 7);
  if (month === budgetMonth) return;
  budgetMonth = month;
  get('budget-month').textContent = new Date().toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  const container = get('budget-categories');
  container.replaceChildren();
  budgetRows = [];
  categories.forEach((category, index) => {
    const limitForm = document.createElement('form');
    limitForm.className = 'budget-category';
    limitForm.noValidate = true;
    const title = document.createElement('h3');
    title.textContent = category;
    const savedLimit = budgets[month]?.[category];
    const savedLabel = document.createElement('p');
    savedLabel.textContent = budgetReadFailed ? 'Лимит недоступен' : savedLimit === undefined ? 'Лимит не задан' : `Лимит: ${money(savedLimit)}`;
    const spentLabel = document.createElement('p');
    const remainingLabel = document.createElement('p');
    const warning = document.createElement('p');
    warning.className = 'budget-message error';
    warning.setAttribute('role', 'status');
    budgetRows.push({ category, spentLabel, remainingLabel, warning });
    const label = document.createElement('label');
    label.htmlFor = `budget-limit-${index}`;
    label.textContent = `Лимит, ₸ · ${category}`;
    const input = document.createElement('input');
    input.id = label.htmlFor;
    input.type = 'text';
    input.inputMode = 'numeric';
    input.placeholder = 'Например, 15 000';
    input.value = savedLimit === undefined ? '' : String(savedLimit);
    input.disabled = budgetReadFailed;
    const message = document.createElement('p');
    message.id = `budget-message-${index}`;
    message.className = 'budget-message';
    message.setAttribute('role', 'status');
    input.setAttribute('aria-describedby', message.id);
    const button = document.createElement('button');
    button.type = 'submit';
    button.textContent = 'Сохранить';
    button.disabled = budgetReadFailed;
    limitForm.append(title, savedLabel, spentLabel, remainingLabel, warning, label, input, button, message);
    limitForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (budgetReadFailed) return;
      if (month !== localDate().slice(0, 7)) {
        render();
        get('budget-storage-status').textContent = 'Месяц изменился. Задай лимит для нового месяца.';
        return;
      }
      const value = input.value.trim();
      const amount = /^0+$/.test(value) ? 0 : parseAmount(value);
      message.className = 'budget-message error';
      input.setAttribute('aria-invalid', String(amount === null));
      if (amount === null) {
        message.textContent = 'Введи целую сумму от 0 до 9 007 199 254 740 991 ₸, например 15 000.';
        input.focus();
        return;
      }
      const next = { ...budgets, [month]: { ...budgets[month], [category]: amount } };
      try {
        localStorage.setItem(BUDGET_STORAGE_KEY, JSON.stringify(next));
      } catch {
        message.textContent = 'Лимит не сохранён. Проверь свободное место и доступ к хранилищу браузера.';
        return;
      }
      budgets = next;
      savedLabel.textContent = `Лимит: ${money(amount)}`;
      updateBudgetAmounts();
      message.className = 'budget-message';
      message.textContent = 'Лимит сохранён.';
      get('budget-storage-status').textContent = '';
    });
    container.append(limitForm);
  });
}

function updateBudgetAmounts() {
  const totals = new Map(categories.map((category) => [category, 0n]));
  expenses.forEach((item) => {
    if (item.date.slice(0, 7) === budgetMonth) {
      totals.set(item.category, totals.get(item.category) + BigInt(item.amount));
    }
  });
  updateBudgetSummary(totals);
  budgetRows.forEach(({ category, spentLabel, remainingLabel, warning }) => {
    const spent = totals.get(category);
    const limit = budgets[budgetMonth]?.[category];
    spentLabel.textContent = expensesReadFailed ? 'Расходы недоступны' : `Потрачено: ${money(spent)}`;
    warning.textContent = '';
    warning.hidden = true;
    if (expensesReadFailed || budgetReadFailed || limit === undefined) {
      remainingLabel.textContent = 'Остаток не рассчитан';
      return;
    }
    const remaining = BigInt(limit) - spent;
    remainingLabel.textContent = `Осталось: ${money(remaining)}`;
    if (remaining < 0n) {
      warning.textContent = `Перерасход: ${money(-remaining)}`;
      warning.hidden = false;
    }
  });
}

function updateBudgetSummary(totals) {
  const limits = categories.map((category) => budgets[budgetMonth]?.[category]).filter((limit) => limit !== undefined);
  const total = limits.reduce((sum, limit) => sum + BigInt(limit), 0n);
  const spent = [...totals.values()].reduce((sum, amount) => sum + amount, 0n);
  get('budget-total').textContent = budgetReadFailed ? 'Бюджет недоступен' : limits.length ? `Общий бюджет: ${money(total)}` : 'Бюджет не задан';
  get('budget-spent').textContent = expensesReadFailed ? 'Расходы недоступны' : `Всего потрачено: ${money(spent)}`;
  const incomplete = !budgetReadFailed && limits.length > 0 && limits.length < categories.length;
  get('budget-completeness').hidden = !incomplete;
  get('budget-completeness').textContent = incomplete ? `Заданы лимиты: ${limits.length} из ${categories.length}. Бюджет неполный` : '';
  const warning = get('budget-warning');
  warning.hidden = true;
  warning.textContent = '';
  if (budgetReadFailed || expensesReadFailed || limits.length === 0) {
    get('budget-remaining').textContent = 'Остаток не рассчитан';
    return;
  }
  const remaining = total - spent;
  get('budget-remaining').textContent = `Общий остаток: ${money(remaining)}`;
  if (remaining < 0n) {
    warning.hidden = false;
    warning.textContent = `Перерасход: ${money(-remaining)}`;
  }
}

function loadExpenses() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === null) return;
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed) || !parsed.every((item) => item && Number.isSafeInteger(item.amount) && item.amount > 0 && categories.includes(item.category) && validDate(item.date) && typeof item.comment === 'string'
      && (item.necessity === undefined || necessityLabels.has(item.necessity))
      && (item.regularity === undefined || regularityLabels.has(item.regularity)))) {
      throw new Error('Invalid saved data');
    }
    expenses = parsed;
  } catch {
    expensesReadFailed = true;
    get('storage-status').textContent = 'Не удалось прочитать сохранённые траты. Данные не перезаписаны. Проверь доступ к хранилищу и обнови страницу.';
    form.querySelector('button[type="submit"]').disabled = true;
  }
}

function setPeriod(period) {
  activePeriod = period;
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const end = new Date(start);
  if (period === 'all') {
    fromInput.value = '';
    toInput.value = '';
  } else {
    if (period === 'yesterday') { start.setDate(start.getDate() - 1); end.setDate(end.getDate() - 1); }
    if (period === 'week') start.setDate(start.getDate() - 6);
    if (period === 'days30') start.setDate(start.getDate() - 29);
    if (period === 'month') { start.setDate(1); end.setMonth(end.getMonth() + 1, 0); }
    if (period === 'previous') { start.setMonth(start.getMonth() - 1, 1); end.setDate(0); }
    fromInput.value = localDate(start);
    toInput.value = localDate(end);
  }
  render();
}

function render() {
  renderBudgets();
  updateBudgetAmounts();
  const today = localDate();
  get('month-label').textContent = new Date().toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  const total = expenses.filter((item) => item.date.slice(0, 7) === today.slice(0, 7)).reduce((sum, item) => sum + BigInt(item.amount), 0n);
  get('month-total').textContent = money(total);
  const from = fromInput.value;
  const to = toInput.value;
  const invalid = fromInput.validity.badInput || toInput.validity.badInput || (from && !validDate(from)) || (to && !validDate(to)) || (from && to && from > to);
  get('period-error').textContent = invalid ? 'Укажи корректный период: начало не позже конца.' : '';
  fromInput.setAttribute('aria-invalid', String(Boolean(invalid)));
  toInput.setAttribute('aria-invalid', String(Boolean(invalid)));
  presets.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.period === activePeriod)));
  const visible = invalid ? [] : expenses.filter((item) => (!from || item.date >= from) && (!to || item.date <= to));
  get('count').textContent = invalid ? '' : `Записей: ${visible.length}`;
  get('empty').hidden = visible.length > 0 || Boolean(invalid);
  get('empty').textContent = expenses.length ? 'За этот период трат нет' : 'Пока нет трат';
  const list = get('expense-list');
  list.replaceChildren();
  visible.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'expense';
    const top = document.createElement('div');
    top.className = 'expense-top';
    const category = document.createElement('strong');
    category.textContent = item.category;
    const amount = document.createElement('strong');
    amount.className = 'expense-amount';
    amount.textContent = money(item.amount);
    top.append(category, amount);
    const date = document.createElement('time');
    date.className = 'expense-meta';
    date.dateTime = item.date;
    date.textContent = item.date.split('-').reverse().join('.');
    li.append(top, date);
    const types = document.createElement('p');
    types.className = 'expense-meta';
    types.textContent = `${necessityLabels.get(item.necessity) || 'Обязательность: не указана'} · ${regularityLabels.get(item.regularity) || 'Регулярность: не указана'}`;
    li.append(types);
    if (item.comment) {
      const comment = document.createElement('p');
      comment.className = 'expense-comment';
      comment.textContent = item.comment;
      li.append(comment);
    }
    list.append(li);
  });
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  get('form-status').textContent = '';
  const amount = parseAmount(amountInput.value);
  const correctDate = validDate(dateInput.value);
  get('amount-error').textContent = amount === null ? 'Введи целую сумму больше 0, например 5 000 (не больше 9 007 199 254 740 991 ₸).' : '';
  get('date-error').textContent = correctDate ? '' : 'Укажи корректную дату.';
  amountInput.setAttribute('aria-invalid', String(amount === null));
  dateInput.setAttribute('aria-invalid', String(!correctDate));
  const necessity = necessityInput.value;
  const regularity = regularityInput.value;
  const correctNecessity = necessityLabels.has(necessity);
  const correctRegularity = regularityLabels.has(regularity);
  get('necessity-error').textContent = correctNecessity ? '' : 'Выбери обязательность траты.';
  get('regularity-error').textContent = correctRegularity ? '' : 'Выбери регулярность траты.';
  necessityInput.setAttribute('aria-invalid', String(!correctNecessity));
  regularityInput.setAttribute('aria-invalid', String(!correctRegularity));
  if (amount === null || !correctDate || !correctNecessity || !correctRegularity) {
    (amount === null ? amountInput : !correctDate ? dateInput : !correctNecessity ? necessityInput : regularityInput).focus();
    return;
  }
  const category = get('category').value;
  if (!categories.includes(category)) return;
  const next = [{ amount, category, date: dateInput.value, comment: get('comment').value.trim(), necessity, regularity }, ...expenses];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    get('storage-status').textContent = 'Трата не сохранена. Проверь свободное место и доступ к хранилищу браузера.';
    return;
  }
  expenses = next;
  amountInput.value = '';
  get('comment').value = '';
  necessityInput.value = '';
  regularityInput.value = '';
  get('storage-status').textContent = '';
  render();
  get('form-status').textContent = 'Трата добавлена.';
  amountInput.focus();
});

presets.forEach((button) => button.addEventListener('click', () => setPeriod(button.dataset.period)));
[fromInput, toInput].forEach((input) => input.addEventListener('input', () => { activePeriod = ''; render(); }));
dateInput.value = localDate();
loadExpenses();
loadBudgets();
setPeriod('all');
// Обновить месяц и относительные периоды после возвращения на страницу.
window.addEventListener('focus', () => activePeriod ? setPeriod(activePeriod) : render());
document.addEventListener('visibilitychange', () => { if (!document.hidden) activePeriod ? setPeriod(activePeriod) : render(); });
