(() => {
  'use strict';

  const STORAGE_KEY = 'bookPredictorStateV1';
  const UI_KEY = 'bookPredictorUiV2';
  const APP_VERSION = '1.1';
  const TODAY = localDateString(new Date());
  const POSITIVE_REASONS = ['Необычная идея','Сильная история','Интрига','Динамика','Неожиданные повороты','Персонажи','Эмоции','Атмосфера','Легко читается','Сильный финал','Практичность','Полезные мысли'];
  const NEGATIVE_REASONS = ['Затянуто','Предсказуемо','Идея не новая','Мало событий','Нелогичный сюжет','Раздражающие герои','Слабый финал','Тяжёлый язык','Много воды','Повторы','Неправдоподобно','Не вызвало эмоций'];
  const CHARACTERISTICS = ['Идея','Сюжет','Новизна','Динамика','Атмосфера','Персонажи','Эмоциональный эффект','Стиль и язык','Финал','Желание читать автора'];

  const state = loadState();
  const ui = loadUi();
  let currentPage = ui.page || 'home';
  let currentProfileTab = 'overview';

  const els = {
    content: document.getElementById('mainContent'),
    title: document.getElementById('pageTitle'),
    eyebrow: document.getElementById('pageEyebrow'),
    modal: document.getElementById('modalRoot'),
    toast: document.getElementById('toastRoot')
  };

  document.addEventListener('DOMContentLoaded', init);

  function init(){
    normalizeState();
    handleSharedUrl();
    registerServiceWorker();
    bindShell();
    maybeWeeklyRefresh();
    render();
  }

  function loadState(){
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : structuredClone(window.STARTER_DATA);
    } catch (e) {
      console.error(e);
      return structuredClone(window.STARTER_DATA);
    }
  }
  function loadUi(){
    try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}'); } catch { return {}; }
  }
  function save(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function saveUi(){ localStorage.setItem(UI_KEY, JSON.stringify(ui)); }
  function normalizeState(){
    state.meta ||= {};
    state.books ||= [];
    state.hiddenIds ||= [];
    state.books.forEach((b,i) => {
      b.id ||= `b_${Date.now()}_${i}`;
      b.addedAppDate = parseDate(b.addedAppDate) || TODAY;
      b.addedWantDate = parseDate(b.addedWantDate);
      b.readDate = parseDate(b.readDate);
      b.statusChangedDate = parseDate(b.statusChangedDate);
      b.format ||= 'text';
      b.source ||= 'Ручной ввод';
      b.forecastHistory ||= [];
    });
    recalculateAll(false);
    save();
  }

  function bindShell(){
    document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.page)));
    document.getElementById('searchButton').addEventListener('click', openGlobalSearch);
    document.getElementById('settingsButton').addEventListener('click', openSettings);
  }
  function navigate(page){ currentPage = page; ui.page = page; saveUi(); render(); }
  function render(){
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === currentPage));
    if(currentPage === 'home') renderHome();
    if(currentPage === 'want') renderListPage('want');
    if(currentPage === 'read') renderListPage('read');
    if(currentPage === 'profile') renderProfile();
    window.scrollTo({top:0,behavior:'instant'});
  }
  function setHeader(title, eyebrow='Мой книжный прогноз'){ els.title.textContent = title; els.eyebrow.textContent = eyebrow; }

  function visibleBooks(status){ return state.books.filter(b => b.status === status && !state.hiddenIds.includes(b.id)); }
  function readBooks(){ return visibleBooks('read'); }
  function wantBooks(){ return visibleBooks('want'); }

  function renderHome(){
    setHeader('Главная');
    const read = readBooks(); const want = wantBooks();
    const withoutImpressions = read.filter(b => !b.impressions).length;
    const needsReview = state.books.filter(b => b.needsReview).length;
    const changes = want.filter(b => b.lastForecastChange && Math.abs(b.lastForecastChange) >= .1).slice(0,4);
    const recent = [...want].sort((a,b)=>dateVal(b.addedWantDate)-dateVal(a.addedWantDate)).slice(0,4);
    els.content.innerHTML = `
      ${state.meta.isDemo ? `<div class="demo-banner"><span>ⓘ</span><div><strong>Демонстрационная выборка</strong>${escapeHtml(state.meta.sourceNote || '')} Импортируй полные Excel-файлы — записи будут добавлены после проверки дублей.</div></div>`:''}
      <section class="hero hero-compact"><p>Твой книжный профиль строится по фактическим оценкам и причинам впечатления.</p></section>
      <section class="kpi-grid">
        ${kpi('Хочу прочитать', want.length, 'книг')}
        ${kpi('Прочитано', read.length, 'книг')}
        ${kpi('Требуют проверки', needsReview, 'записей')}
        ${kpi('Без впечатлений', withoutImpressions, 'книг')}
      </section>
      <section class="section">
        <div class="section-heading"><h2>Быстрые действия</h2></div>
        <div class="quick-actions">
          ${quickAction('＋','Добавить книгу','Вручную или по ссылке','add')}
          ${quickAction('⇧','Импорт','Excel, JSON, скриншот','import')}
          ${quickAction('↻','Обновить','Пересчитать прогнозы','refresh')}
          ${quickAction('⤓','Резервная копия','Сохранить данные','backup')}
        </div>
      </section>
      <section class="section">
        <div class="section-heading"><h2>Последние добавленные</h2><button class="link-button" data-go="want">Смотреть все</button></div>
        <div class="book-list">${recent.map(bookRow).join('') || empty('Пока нет книг')}</div>
      </section>
      <section class="section">
        <div class="section-heading"><h2>Изменившиеся прогнозы</h2></div>
        <div class="book-list">${changes.map(bookRow).join('') || `<div class="card empty">Существенных изменений пока нет.</div>`}</div>
      </section>
      <section class="section card" style="padding:14px">
        <h3>Состояние модели</h3>
        <p class="muted small">Подробно размечено: <strong>${read.filter(b=>b.impressions).length}</strong> из ${read.length}. Для устойчивого персонального профиля рекомендуется разметить 20–30 показательных книг.</p>
      </section>`;
    bindBookRows();
    els.content.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', handleQuickAction));
    els.content.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click',()=>navigate(b.dataset.go)));
  }

  function kpi(label,value,note){ return `<div class="kpi card"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-note">${note}</div></div>`; }
  function quickAction(icon,title,note,action){ return `<button class="quick-action" data-action="${action}"><span>${icon}</span><strong>${title}</strong><small>${note}</small></button>`; }
  function handleQuickAction(e){
    const a=e.currentTarget.dataset.action;
    if(a==='add') openAddBook(); if(a==='import') openImport(); if(a==='refresh') refreshNow(); if(a==='backup') exportBackup();
  }

  function defaultListFilter(status){
    return {query:'',year:'',from:'',to:'',confidence:'',format:'',source:'',minRating:'',preset:'',sort:status==='want'?'added-desc':'read-desc',showFilters:false};
  }

  function renderListPage(status){
    setHeader(status==='want'?'Хочу прочитать':'Прочитано');
    const filter = {...defaultListFilter(status), ...(ui[`${status}Filter`] || {})};
    // Миграция старого технического значения фильтра «Без впечатлений».
    if(filter.query==='__unmarked__'){ filter.query=''; filter.preset='unmarked'; }
    ui[`${status}Filter`] = filter;
    const allStatusBooks = visibleBooks(status);
    const baseBooks = applyFilters(allStatusBooks,filter,status,true);
    const books = applyFilters(allStatusBooks,filter,status,false);
    const years = [...new Set(allStatusBooks.map(b => getYear(status==='want'?b.addedWantDate:b.readDate)).filter(Boolean))].sort((a,b)=>b-a);
    els.content.innerHTML = `
      <div class="toolbar">
        <div class="searchbox"><input id="listSearch" value="${escapeAttr(filter.query||'')}" placeholder="Поиск в списке"></div>
        <button class="filter-button" id="toggleFilters">Фильтры</button>
      </div>
      <section class="filter-panel card ${filter.showFilters?'':'hidden'}" id="filterPanel">
        <div class="filter-grid">
          <div class="field"><label>Год ${status==='want'?'добавления':'прочтения'}</label><select id="yearFilter"><option value="">Все годы</option>${years.map(y=>`<option ${String(filter.year)===String(y)?'selected':''}>${y}</option>`).join('')}<option value="unknown" ${filter.year==='unknown'?'selected':''}>Без даты</option></select></div>
          <div class="field"><label>Сортировка</label><select id="sortFilter">${sortOptions(status,filter.sort)}</select></div>
          <div class="field"><label>Период с</label><input type="date" id="fromFilter" value="${filter.from||''}"></div>
          <div class="field"><label>по</label><input type="date" id="toFilter" value="${filter.to||''}"></div>
          ${status==='want'?`<div class="field"><label>Уверенность</label><select id="confidenceFilter"><option value="">Любая</option>${['Высокая','Средняя','Низкая'].map(v=>`<option ${filter.confidence===v?'selected':''}>${v}</option>`).join('')}</select></div>`:''}
          <div class="field"><label>Формат</label><select id="formatFilter"><option value="">Любой</option><option value="text" ${filter.format==='text'?'selected':''}>Текст</option><option value="audio" ${filter.format==='audio'?'selected':''}>Аудио</option></select></div>
          <div class="field"><label>Источник</label><select id="sourceFilter"><option value="">Любой</option>${['LiveLib','Яндекс Книги','Ручной ввод','Импорт Excel'].map(v=>`<option ${filter.source===v?'selected':''}>${v}</option>`).join('')}</select></div>
          <div class="field"><label>${status==='want'?'Прогноз от':'Оценка от'}</label><select id="ratingFilter"><option value="">Любая</option>${[2,2.5,3,3.5,4,4.5,5].map(v=>`<option value="${v}" ${String(filter.minRating)===String(v)?'selected':''}>${v}</option>`).join('')}</select></div>
        </div>
        <div class="filter-actions"><button class="secondary" id="resetFilters">Сбросить</button><button class="primary" id="applyFilters">Применить</button></div>
      </section>
      <div class="segmented">
        <button data-preset="" class="${!filter.preset?'active':''}">Все (${baseBooks.length})</button>
        ${status==='want'?`<button data-preset="liked" class="${filter.preset==='liked'?'active':''}">Прогноз ≥ 3,5</button><button data-preset="low" class="${filter.preset==='low'?'active':''}">Низкая уверенность</button>`:`<button data-preset="five" class="${filter.preset==='five'?'active':''}">Оценка 5</button><button data-preset="unmarked" class="${filter.preset==='unmarked'?'active':''}">Без впечатлений</button>`}
      </div>
      <div class="book-list">${books.map(bookRow).join('') || empty('По выбранным условиям книги не найдены')}</div>
      <button class="fab" id="fabAdd" aria-label="Добавить книгу">＋</button>`;
    bindListControls(status,filter);
    bindBookRows();
  }

  function sortOptions(status,current){
    const opts = status==='want' ? [
      ['added-desc','Сначала недавно добавленные'],['added-asc','Сначала давно добавленные'],['forecast-desc','Прогноз: высокий → низкий'],['forecast-asc','Прогноз: низкий → высокий'],['confidence','Сначала высокая уверенность'],['author','По автору'],['oldest-want','Дольше всего в списке']
    ] : [
      ['read-desc','Сначала недавно прочитанные'],['read-asc','Сначала давно прочитанные'],['rating-desc','Оценка: высокая → низкая'],['rating-asc','Оценка: низкая → высокая'],['author','По автору']
    ];
    return opts.map(([v,t])=>`<option value="${v}" ${current===v?'selected':''}>${t}</option>`).join('');
  }
  function bindListControls(status,filter){
    document.getElementById('toggleFilters').addEventListener('click',()=>{filter.showFilters=!filter.showFilters;saveUi();renderListPage(status)});
    document.getElementById('listSearch').addEventListener('input',debounce(e=>{filter.query=e.target.value;saveUi();renderListPage(status)},250));
    document.getElementById('fabAdd').addEventListener('click',()=>openAddBook(status));
    document.getElementById('applyFilters')?.addEventListener('click',()=>{
      filter.year=document.getElementById('yearFilter').value;
      filter.sort=document.getElementById('sortFilter').value;
      filter.from=document.getElementById('fromFilter').value;
      filter.to=document.getElementById('toFilter').value;
      filter.format=document.getElementById('formatFilter').value;
      filter.source=document.getElementById('sourceFilter').value;
      filter.minRating=document.getElementById('ratingFilter').value;
      if(status==='want') filter.confidence=document.getElementById('confidenceFilter').value;
      saveUi();renderListPage(status);
    });
    document.getElementById('resetFilters')?.addEventListener('click',()=>{
      ui[`${status}Filter`]={...defaultListFilter(status),showFilters:true};
      saveUi();renderListPage(status);
    });
    els.content.querySelectorAll('[data-preset]').forEach(btn=>btn.addEventListener('click',()=>{
      const p=btn.dataset.preset || '';
      filter.preset = p && filter.preset===p ? '' : p;
      saveUi();renderListPage(status);
    }));
  }

  function applyFilters(books,f,status,ignorePreset=false){
    let out=[...books];
    const q=(f.query||'').toLowerCase().trim();
    if(q) out=out.filter(b=>`${b.title} ${b.author} ${b.category||''} ${b.series||''}`.toLowerCase().includes(q));
    const dateField=status==='want'?'addedWantDate':'readDate';
    if(f.year==='unknown') out=out.filter(b=>!b[dateField]);
    else if(f.year) out=out.filter(b=>String(getYear(b[dateField]))===String(f.year));
    if(f.from) out=out.filter(b=>dateVal(b[dateField])>=dateVal(f.from));
    if(f.to) out=out.filter(b=>dateVal(b[dateField])<=dateVal(f.to));
    if(f.format) out=out.filter(b=>b.format===f.format);
    if(f.source) out=out.filter(b=>b.source===f.source);
    if(f.confidence) out=out.filter(b=>b.forecast?.confidence===f.confidence);
    if(f.minRating) out=out.filter(b=>(status==='want'?b.forecast?.score:b.myRating)>=Number(f.minRating));
    if(!ignorePreset){
      if(f.preset==='liked') out=out.filter(b=>(b.forecast?.score??0)>=3.5);
      if(f.preset==='low') out=out.filter(b=>b.forecast?.confidence==='Низкая');
      if(f.preset==='five') out=out.filter(b=>Number(b.myRating)===5);
      if(f.preset==='unmarked') out=out.filter(b=>!b.impressions);
    }
    out.sort(sorter(f.sort,status));
    return out;
  }

  function sorter(sort,status){
    const byDate=(field,desc=true)=>(a,b)=>(dateVal(a[field])-dateVal(b[field]))*(desc?-1:1);
    const map={
      'added-desc':byDate('addedWantDate',true),'added-asc':byDate('addedWantDate',false),'oldest-want':byDate('addedWantDate',false),
      'read-desc':byDate('readDate',true),'read-asc':byDate('readDate',false),
      'forecast-desc':(a,b)=>(b.forecast?.score||0)-(a.forecast?.score||0),'forecast-asc':(a,b)=>(a.forecast?.score||0)-(b.forecast?.score||0),
      'rating-desc':(a,b)=>(b.myRating||0)-(a.myRating||0),'rating-asc':(a,b)=>(a.myRating||0)-(b.myRating||0),
      'author':(a,b)=>(a.author||'').localeCompare(b.author||'','ru'),
      'confidence':(a,b)=>confidenceRank(b.forecast?.confidence)-confidenceRank(a.forecast?.confidence)
    }; return map[sort]||map[status==='want'?'added-desc':'read-desc'];
  }

  function bookRow(b){
    const date = b.status==='want' ? b.addedWantDate : b.readDate;
    const score = b.status==='want' ? b.forecast?.score : b.myRating;
    const conf = b.forecast?.confidence;
    return `<article class="book-row card" data-book-id="${b.id}">
      <div class="cover">${escapeHtml(shortTitle(b.title))}</div>
      <div><div class="book-title">${escapeHtml(b.title)}</div><div class="book-author">${escapeHtml(b.author||'Автор не указан')}</div>
        <div class="meta"><span>${escapeHtml(b.category||'Жанр не указан')}</span><span class="tag">${b.format==='audio'?'Аудио':'Текст'}</span>${date?`<span>${b.status==='want'?'Добавлена':'Прочитана'}: ${formatDate(date)}</span>`:'<span>Дата неизвестна</span>'}${b.needsReview?'<span class="tag risk">Проверить</span>':''}</div></div>
      <div class="forecast-chip"><div class="forecast-score">${score!=null?formatScore(score):'—'}</div><div class="forecast-caption">${b.status==='want'?'прогноз': 'твоя оценка'}</div>${conf?`<span class="tag ${confidenceClass(conf)}">${conf}</span>`:''}</div>
    </article>`;
  }
  function bindBookRows(){ els.content.querySelectorAll('[data-book-id]').forEach(row=>row.addEventListener('click',()=>openBook(row.dataset.bookId))); }
  function empty(t){return `<div class="card empty">${escapeHtml(t)}</div>`}

  function openBook(id){
    const b=state.books.find(x=>x.id===id); if(!b)return;
    if(b.status==='want') openForecastDetail(b); else openReadDetail(b);
  }
  function openForecastDetail(b){
    const f=b.forecast||calculateForecast(b);
    openModal(`
      <div class="detail-head"><div class="detail-cover">${escapeHtml(shortTitle(b.title))}</div><div><h2>${escapeHtml(b.title)}</h2><p class="muted" style="margin:4px 0">${escapeHtml(b.author||'')}</p><div class="meta"><span>${escapeHtml(b.category||'')}</span><span class="tag">${b.format==='audio'?'Аудио':'Текст'}</span></div></div></div>
      <section class="score-panel card"><div class="muted small">Персональный прогноз</div><div class="big-score">${formatScore(f.score)} / 5,0</div><p>Ожидаемая фактическая оценка: <strong>от ${formatScore(f.low)} до ${formatScore(f.high)}</strong></p><div class="score-grid"><div class="score-box"><strong>${f.probability}%</strong><small>вероятность, что понравится</small></div><div class="score-box"><strong>${f.confidence}</strong><small>уверенность прогноза</small></div></div></section>
      <section class="card" style="padding:15px;margin-bottom:12px"><h3>Почему может понравиться</h3><ul class="reason-list good">${f.positive.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></section>
      <section class="card" style="padding:15px;margin-bottom:12px"><h3>Что может не понравиться</h3><ul class="reason-list risk">${f.risks.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></section>
      <section class="card" style="padding:15px;margin-bottom:12px"><h3>Основание прогноза</h3><p>${escapeHtml(f.explanation)}</p><p class="muted small">Уровень уверенности: ${escapeHtml(f.confidenceReason)}. Пояснение формируется без сюжетных спойлеров.</p></section>
      ${b.lastForecastChange?`<div class="warning">Прогноз изменился на ${b.lastForecastChange>0?'+':''}${b.lastForecastChange.toFixed(1)} после последнего пересчёта.</div>`:''}
      <div class="button-row" style="margin-top:14px"><button class="secondary" data-modal-action="wrong">Прогноз кажется неверным</button><button class="primary" data-modal-action="mark-read">Отметить прочитанной</button></div>
      <div class="button-row" style="margin-top:8px"><button class="secondary" data-modal-action="edit">Редактировать</button><button class="secondary" data-modal-action="remove">Удалить / скрыть</button></div>`, b.title);
    bindModalAction('wrong',()=>openForecastFeedback(b));
    bindModalAction('mark-read',()=>openImpressions(b,true));
    bindModalAction('edit',()=>openAddBook('want',b));
    bindModalAction('remove',()=>openRemoveBook(b));
  }
  function openReadDetail(b){
    openModal(`
      <div class="detail-head"><div class="detail-cover">${escapeHtml(shortTitle(b.title))}</div><div><h2>${escapeHtml(b.title)}</h2><p class="muted" style="margin:4px 0">${escapeHtml(b.author||'')}</p><div class="meta"><span>${escapeHtml(b.category||'')}</span><span class="tag">${b.format==='audio'?'Аудио':'Текст'}</span></div></div></div>
      <section class="score-panel card"><div class="muted small">Твоя оценка</div><div class="big-score">${formatScore(b.myRating||0)} / 5,0</div><p>LiveLib: <strong>${b.livelibRating?formatScore(b.livelibRating):'—'}</strong> &nbsp; Яндекс Книги: <strong>${b.yandexRating?formatScore(b.yandexRating):'—'}</strong></p><p class="muted small">Прочитана: ${b.readDate?formatDate(b.readDate):'дата неизвестна'}</p></section>
      <section class="card" style="padding:15px;margin-bottom:12px"><h3>Общее впечатление</h3><p>${escapeHtml(b.impressions?.overall||'Ещё не заполнено')}</p>${b.impressions?.comment?`<p class="muted">${escapeHtml(b.impressions.comment)}</p>`:''}</section>
      ${b.format==='audio'?`<section class="card" style="padding:15px;margin-bottom:12px"><h3>Чтец</h3><p>Оценка: <strong>${b.narratorRating?formatScore(b.narratorRating):'не указана'}</strong></p></section>`:''}
      ${b.poorMemory?'<div class="warning">Отмечено: содержание плохо помнится. Эта книга слабее влияет на прогноз.</div>':''}
      <div class="button-row" style="margin-top:14px"><button class="primary" data-modal-action="impressions">${b.impressions?'Изменить впечатления':'Заполнить впечатления'}</button><button class="secondary" data-modal-action="edit">Редактировать</button></div>
      <div class="button-row" style="margin-top:8px"><button class="secondary" data-modal-action="remove">Удалить / скрыть</button></div>`, b.title);
    bindModalAction('impressions',()=>openImpressions(b,false)); bindModalAction('edit',()=>openAddBook('read',b)); bindModalAction('remove',()=>openRemoveBook(b));
  }

  function openForecastFeedback(b){
    const reasons=['Сейчас не хочу такой жанр','Описание не заинтересовало','Неверно определён жанр','Неверно определены признаки','Прогноз слишком высокий','Прогноз слишком низкий','Неверно выбраны похожие книги','Другая причина'];
    openModal(`<div class="field"><label>Почему прогноз кажется неверным?</label><div class="check-grid">${reasons.map((r,i)=>`<label class="check-pill"><input type="radio" name="feedback" value="${escapeAttr(r)}" ${i===0?'checked':''}>${escapeHtml(r)}</label>`).join('')}</div></div><div class="field"><label>Комментарий</label><textarea id="feedbackComment"></textarea></div><button class="primary full" id="saveFeedback">Сохранить обратную связь</button>`, 'Обратная связь');
    document.getElementById('saveFeedback').addEventListener('click',()=>{
      const reason=document.querySelector('input[name="feedback"]:checked')?.value||''; b.forecastFeedback ||= []; b.forecastFeedback.push({date:TODAY,reason,comment:document.getElementById('feedbackComment').value}); b.needsReview=reason.includes('Неверно'); save(); closeModal(); toast('Обратная связь сохранена'); render();
    });
  }

  function openImpressions(book,markRead){
    const old=book.impressions||{};
    const statusOptions=['Одна из любимых','Очень понравилась','Понравилась','Нормально','Скорее не понравилась','Не понравилась','Бросила'];
    const expectationOptions=['Лучше ожиданий','Соответствовала ожиданиям','Хуже ожиданий','Ожиданий не было'];
    openModal(`
      <div class="form-grid">
        <div class="field"><label>Оценка (шаг 0,5)</label><select id="impRating">${ratingOptions(book.myRating||3.5)}</select></div>
        <div class="field"><label>Общее впечатление</label><select id="impOverall">${statusOptions.map(x=>`<option ${old.overall===x?'selected':''}>${x}</option>`).join('')}</select></div>
        <div class="field"><label>Дата прочтения</label><input type="date" id="impReadDate" value="${book.readDate||TODAY}"></div>
        <div class="field"><label>Формат</label><select id="impFormat"><option value="text" ${book.format==='text'?'selected':''}>Текст</option><option value="audio" ${book.format==='audio'?'selected':''}>Аудио</option></select></div>
      </div>
      <div class="field"><label>Что понравилось — до трёх причин</label><div class="check-grid" id="positiveReasons">${reasonChecks(POSITIVE_REASONS,old.positive||[],'pos')}</div></div>
      <div class="field"><label>Что не понравилось — до трёх причин</label><div class="check-grid" id="negativeReasons">${reasonChecks(NEGATIVE_REASONS,old.negative||[],'neg')}</div></div>
      <div class="field"><label>Характеристики — заполняй только важные</label><div class="form-grid">${CHARACTERISTICS.map(c=>`<div class="field"><label>${c}</label><select data-char="${escapeAttr(c)}"><option value="">Не оценивать</option>${['Очень понравилось','Понравилось','Нейтрально','Не понравилось','Сильно не понравилось','Не могу оценить'].map(v=>`<option ${old.characteristics?.[c]===v?'selected':''}>${v}</option>`).join('')}</select></div>`).join('')}</div></div>
      <div class="field"><label>Соответствие ожиданиям</label><select id="impExpectation">${expectationOptions.map(x=>`<option ${old.expectation===x?'selected':''}>${x}</option>`).join('')}</select></div>
      <div class="field"><label>Что конкретно повлияло на оценку?</label><textarea id="impComment">${escapeHtml(old.comment||'')}</textarea></div>
      <label class="check-pill"><input type="checkbox" id="poorMemory" ${book.poorMemory?'checked':''}>Плохо помню содержание</label>
      <div id="narratorBlock" style="margin-top:12px;${book.format==='audio'?'':'display:none'}"><div class="field"><label>Оценка чтеца</label><select id="narratorRating">${ratingOptions(book.narratorRating||3.5)}</select></div><div class="field"><label>Комментарий о чтеце</label><textarea id="narratorComment">${escapeHtml(book.narratorComment||'')}</textarea></div></div>
      <button class="primary full" id="saveImpressions" style="margin-top:14px">Сохранить</button>`, 'Впечатления о книге');
    enforceMaxChecks('pos',3); enforceMaxChecks('neg',3);
    document.getElementById('impFormat').addEventListener('change',e=>document.getElementById('narratorBlock').style.display=e.target.value==='audio'?'block':'none');
    document.getElementById('saveImpressions').addEventListener('click',()=>{
      const chars={}; document.querySelectorAll('[data-char]').forEach(s=>{if(s.value)chars[s.dataset.char]=s.value});
      book.myRating=Number(document.getElementById('impRating').value); book.status='read'; book.statusChangedDate=TODAY; book.readDate=document.getElementById('impReadDate').value||TODAY; book.format=document.getElementById('impFormat').value; book.poorMemory=document.getElementById('poorMemory').checked;
      book.impressions={overall:document.getElementById('impOverall').value,positive:selectedValues('pos'),negative:selectedValues('neg'),characteristics:chars,expectation:document.getElementById('impExpectation').value,comment:document.getElementById('impComment').value.trim()};
      if(book.format==='audio'){book.narratorRating=Number(document.getElementById('narratorRating').value);book.narratorComment=document.getElementById('narratorComment').value.trim()}
      recalculateAll(true); save(); closeModal(); toast(markRead?'Книга перенесена в «Прочитано»':'Впечатления сохранены'); navigate('read');
    });
  }
  function reasonChecks(list,selected,name){return list.map(x=>`<label class="check-pill"><input type="checkbox" name="${name}" value="${escapeAttr(x)}" ${selected.includes(x)?'checked':''}>${escapeHtml(x)}</label>`).join('')}
  function enforceMaxChecks(name,max){document.querySelectorAll(`input[name="${name}"]`).forEach(c=>c.addEventListener('change',()=>{if(selectedValues(name).length>max){c.checked=false;toast(`Можно выбрать не более ${max}`)}}))}
  function selectedValues(name){return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(x=>x.value)}

  function openAddBook(defaultStatus='want',editBook=null){
    const b=editBook||{};
    openModal(`<div class="form-grid">
      <div class="field full-span"><label>Название *</label><input id="bookTitle" value="${escapeAttr(b.title||'')}"></div>
      <div class="field full-span"><label>Автор *</label><input id="bookAuthor" value="${escapeAttr(b.author||'')}"></div>
      <div class="field"><label>Список</label><select id="bookStatus"><option value="want" ${(b.status||defaultStatus)==='want'?'selected':''}>Хочу прочитать</option><option value="read" ${(b.status||defaultStatus)==='read'?'selected':''}>Прочитано</option></select></div>
      <div class="field"><label>Формат</label><select id="bookFormat"><option value="text" ${(b.format||'text')==='text'?'selected':''}>Текст</option><option value="audio" ${b.format==='audio'?'selected':''}>Аудио</option></select></div>
      <div class="field"><label>LiveLib</label><input type="number" min="1" max="5" step="0.01" id="bookLive" value="${b.livelibRating||''}"></div>
      <div class="field"><label>Яндекс Книги</label><input type="number" min="1" max="5" step="0.01" id="bookYandex" value="${b.yandexRating||''}"></div>
      <div class="field"><label>Дата добавления в «Хочу»</label><input type="date" id="bookAdded" value="${b.addedWantDate||TODAY}"></div>
      <div class="field"><label>Дата прочтения</label><input type="date" id="bookRead" value="${b.readDate||''}"></div>
      <div class="field full-span"><label>Жанр / категория</label><input id="bookCategory" value="${escapeAttr(b.category||'')}"></div>
      <div class="field full-span"><label>Серия</label><input id="bookSeries" value="${escapeAttr(b.series||'')}"></div>
      <div class="field full-span"><label>Ссылка LiveLib или Яндекс Книг</label><input id="bookUrl" value="${escapeAttr(b.sourceUrl||'')}"></div>
      <div class="field full-span"><label>Аннотация / заметка</label><textarea id="bookNote">${escapeHtml(b.note||'')}</textarea></div>
    </div><button class="primary full" id="saveBook">${editBook?'Сохранить изменения':'Добавить книгу'}</button>`, editBook?'Редактирование':'Добавить книгу');
    document.getElementById('saveBook').addEventListener('click',()=>{
      const title=document.getElementById('bookTitle').value.trim(),author=document.getElementById('bookAuthor').value.trim(); if(!title||!author){toast('Укажи название и автора');return}
      const target=editBook||{id:`b_${Date.now()}`,addedAppDate:TODAY,source:'Ручной ввод',forecastHistory:[]};
      Object.assign(target,{title,author,status:document.getElementById('bookStatus').value,format:document.getElementById('bookFormat').value,livelibRating:numOrNull(document.getElementById('bookLive').value),yandexRating:numOrNull(document.getElementById('bookYandex').value),addedWantDate:document.getElementById('bookAdded').value||null,readDate:document.getElementById('bookRead').value||null,category:document.getElementById('bookCategory').value.trim(),series:document.getElementById('bookSeries').value.trim(),sourceUrl:document.getElementById('bookUrl').value.trim(),note:document.getElementById('bookNote').value.trim(),manualEdited:true});
      if(!editBook) state.books.push(target); recalculateAll(true); save(); closeModal(); toast(editBook?'Книга обновлена':'Книга добавлена'); render();
    });
  }

  function openRemoveBook(b){
    openModal(`<p>Что сделать с книгой <strong>${escapeHtml(b.title)}</strong>?</p><button class="secondary full" id="hideBook">Скрыть из списка и сохранить историю</button><button class="danger full" id="deleteBook" style="margin-top:9px">Удалить полностью</button>`, 'Удаление книги');
    document.getElementById('hideBook').addEventListener('click',()=>{state.hiddenIds.push(b.id);save();closeModal();toast('Книга скрыта');render()});
    document.getElementById('deleteBook').addEventListener('click',()=>{if(confirm('Удалить карточку, прогноз и связанную историю без возможности восстановления?')){state.books=state.books.filter(x=>x.id!==b.id);state.hiddenIds=state.hiddenIds.filter(x=>x!==b.id);save();closeModal();toast('Книга удалена');render()}});
  }

  function renderProfile(){
    setHeader('Профиль вкуса');
    const stats=profileStats();
    els.content.innerHTML=`
      <div class="profile-tabs">${[['overview','Обзор'],['likes','Что нравится'],['dislikes','Что не нравится'],['accuracy','Точность']].map(([v,t])=>`<button data-profile-tab="${v}" class="${currentProfileTab===v?'active':''}">${t}</button>`).join('')}</div>
      <div id="profileBody">${profileTabHtml(currentProfileTab,stats)}</div>`;
    els.content.querySelectorAll('[data-profile-tab]').forEach(b=>b.addEventListener('click',()=>{currentProfileTab=b.dataset.profileTab;renderProfile()}));
  }
  function profileTabHtml(tab,s){
    if(tab==='accuracy') return accuracyHtml(s);
    if(tab==='likes') return `<section class="card" style="padding:15px"><h2>Что повышает оценку</h2>${s.positive.map(x=>impactRow(x.label,x.value,true,x.count)).join('')||'<p class="muted">Нужно больше размеченных книг.</p>'}</section>`;
    if(tab==='dislikes') return `<section class="card" style="padding:15px"><h2>Что снижает оценку</h2>${s.negative.map(x=>impactRow(x.label,x.value,false,x.count)).join('')||'<p class="muted">Нужно больше размеченных книг.</p>'}</section>`;
    return `<section class="kpi-grid">${kpi('Средняя оценка',formatScore(s.avg),'твоя')}${kpi('Строже LiveLib',formatScore(Math.abs(s.delta)),'балла в среднем')}${kpi('Оценки 4–5',`${s.highShare}%`,'прочитанных')}${kpi('Размечено',s.marked,'книг')}</section>
      <section class="card" style="padding:15px;margin-bottom:14px"><h2>Сильные зоны</h2><p>${escapeHtml(s.strongZones.join(', ')||'Пока недостаточно данных')}</p></section>
      <section class="card" style="padding:15px;margin-bottom:14px"><h2>Риск-зоны</h2><p>${escapeHtml(s.riskZones.join(', ')||'Пока недостаточно данных')}</p></section>
      <section class="card" style="padding:15px"><h2>Ключевые причины</h2>${s.positive.slice(0,5).map(x=>impactRow(x.label,x.value,true,x.count)).join('')}${s.negative.slice(0,5).map(x=>impactRow(x.label,x.value,false,x.count)).join('')}</section>`;
  }
  function impactRow(label,value,positive,count){return `<div class="impact-row"><div>${escapeHtml(label)}<div class="muted small">Основано на ${count} книг.</div></div><div class="impact-value ${positive?'positive':'negative'}">${positive?'+':'−'}${Math.abs(value).toFixed(2)}</div></div>`}
  function accuracyHtml(s){
    const a=s.accuracy;
    return `<section class="kpi-grid">${kpi('Проверено прогнозов',a.count,'книг')}${kpi('Средняя ошибка',a.count?formatScore(a.mae):'—','балла')}${kpi('Ошибка ≤ 0,5',a.count?`${a.within05}%`:'—','прогнозов')}${kpi('Верно «понравится»',a.count?`${a.classAccuracy}%`:'—','порог 3,5')}</section>
      <section class="card" style="padding:15px;margin-bottom:14px"><h2>Распределение ошибок</h2>${progress('Ошибка ≤ 0,5',a.within05,'green')}${progress('Ошибка ≤ 1,0',a.within10,'orange')}${progress('Ошибка > 1,0',a.over10,'red')}</section>
      <section class="card" style="padding:15px"><h2>Точность по уверенности</h2>${['Высокая','Средняя','Низкая'].map(c=>progress(c,a.byConfidence[c]||0,c==='Высокая'?'green':c==='Средняя'?'orange':'red')).join('')}<p class="muted small">Для надёжной оценки желательно проверить не менее 20–30 прогнозов.</p></section>`;
  }
  function progress(label,value,cls){return `<div class="progress-row"><span>${label}</span><div class="bar ${cls}"><i style="width:${Math.max(0,Math.min(100,value||0))}%"></i></div><strong>${Math.round(value||0)}%</strong></div>`}

  function profileStats(){
    const read=readBooks(); const avg=weightedAverage(read.map(b=>({v:b.myRating,w:b.poorMemory?.5:1}))); const withSite=read.filter(b=>b.livelibRating); const delta=withSite.length?average(withSite.map(b=>b.myRating-b.livelibRating)):0;
    const highShare=read.length?Math.round(read.filter(b=>b.myRating>=4).length/read.length*100):0;
    const reasonImpact={}; read.forEach(b=>{(b.impressions?.positive||[]).forEach(r=>collectImpact(reasonImpact,r,b.myRating,avg));(b.impressions?.negative||[]).forEach(r=>collectImpact(reasonImpact,r,b.myRating,avg));});
    const arr=Object.entries(reasonImpact).map(([label,v])=>({label,value:v.sum/v.count,count:v.count}));
    const positive=arr.filter(x=>x.value>=0).sort((a,b)=>b.value-a.value),negative=arr.filter(x=>x.value<0).sort((a,b)=>a.value-b.value);
    const cat={}; read.forEach(b=>{const k=b.category||'Без категории';cat[k]||=[];cat[k].push(b.myRating)}); const cats=Object.entries(cat).map(([k,v])=>({k,avg:average(v),n:v.length})).filter(x=>x.n>=1);
    const strongZones=cats.filter(x=>x.avg>=4).sort((a,b)=>b.avg-a.avg).slice(0,4).map(x=>x.k); const riskZones=cats.filter(x=>x.avg<3).sort((a,b)=>a.avg-b.avg).slice(0,4).map(x=>x.k);
    return {avg,delta,highShare,marked:read.filter(b=>b.impressions).length,positive,negative,strongZones,riskZones,accuracy:accuracyStats()};
  }
  function collectImpact(obj,key,rating,avg){obj[key]||={sum:0,count:0};obj[key].sum+=rating-avg;obj[key].count++}
  function accuracyStats(){
    const checked=readBooks().filter(b=>b.forecastBeforeRead&&b.myRating!=null); if(!checked.length)return{count:0,mae:0,within05:0,within10:0,over10:0,classAccuracy:0,byConfidence:{}};
    const errors=checked.map(b=>Math.abs(b.forecastBeforeRead.score-b.myRating)); const classCorrect=checked.filter(b=>(b.forecastBeforeRead.score>=3.5)===(b.myRating>=3.5)).length; const by={}; ['Высокая','Средняя','Низкая'].forEach(c=>{const x=checked.filter(b=>b.forecastBeforeRead.confidence===c);by[c]=x.length?Math.round(x.filter((b,i)=>Math.abs(b.forecastBeforeRead.score-b.myRating)<=.5).length/x.length*100):0});
    return{count:checked.length,mae:average(errors),within05:pct(errors.filter(e=>e<=.5).length,errors.length),within10:pct(errors.filter(e=>e<=1).length,errors.length),over10:pct(errors.filter(e=>e>1).length,errors.length),classAccuracy:pct(classCorrect,checked.length),byConfidence:by};
  }

  function calculateForecast(book){
    const read=readBooks();
    const overall=weightedAverage(read.map(b=>({v:b.myRating,w:recencyWeight(b.readDate)*(b.poorMemory?.45:1)})))||3.6;
    let score=overall; const factors=[]; const risks=[]; let evidence=0;
    const author=read.filter(b=>normalize(b.author)===normalize(book.author));
    if(author.length){const av=weightedAverage(author.map(b=>({v:b.myRating,w:recencyWeight(b.readDate)})));const effect=(av-overall)*Math.min(.85,.45+author.length*.13);score+=effect;factors.push(`${book.author}: средняя личная оценка ${formatScore(av)} по ${author.length} книг.`);evidence+=author.length*3;if(av<3.2)risks.push('По этому автору есть отрицательный личный опыт.');}
    const catTokens=tokenize(book.category); const similar=read.filter(b=>overlap(catTokens,tokenize(b.category))>=.25);
    if(similar.length){const av=weightedAverage(similar.map(b=>({v:b.myRating,w:recencyWeight(b.readDate)})));score+=(av-overall)*.45;factors.push(`Похожие жанры и темы в среднем получают ${formatScore(av)}.`);evidence+=Math.min(8,similar.length);if(av<3.2)risks.push('Похожие по типу книги нередко получали низкую оценку.');}
    const site=[book.livelibRating,book.yandexRating].filter(Number.isFinite); if(site.length){const siteAvg=average(site);const userSite=read.filter(b=>b.livelibRating).map(b=>b.myRating-b.livelibRating);const strict=userSite.length?average(userSite):-.4;const adjusted=siteAvg+strict;score+=clamp((adjusted-score)*.22,-.35,.35);factors.push(`Оценка аудитории ${formatScore(siteAvg)} скорректирована на твою обычную строгость.`);evidence+=2;if(siteAvg<3.7)risks.push('Средняя оценка читателей ниже обычной для списка.');}
    if(book.forecastSeed && !book.manualEdited){score=score*.45+book.forecastSeed*.55;factors.push('Учтён ранее рассчитанный персональный прогноз.');evidence+=4;}
    const feedback=(book.forecastFeedback||[]).at(-1); if(feedback?.reason.includes('слишком высокий'))score-=.3;if(feedback?.reason.includes('слишком низкий'))score+=.3;
    score=round1(clamp(score,1,5)); const confidence=evidence>=12?'Высокая':evidence>=5?'Средняя':'Низкая'; const range=confidence==='Высокая'?.5:confidence==='Средняя'?.7:1;
    const probability=Math.round(100/(1+Math.exp(-2.2*(score-3.5))));
    const positive=[]; if(author.length&&average(author.map(x=>x.myRating))>=4)positive.push('Есть сильный положительный сигнал по автору.');if(similar.length&&average(similar.map(x=>x.myRating))>=3.8)positive.push('Жанр и тематические признаки совпадают с удачными чтениями.');if((book.livelibRating||0)>=4.3)positive.push('Книга высоко оценена широкой аудиторией.');if(book.forecastReason)positive.push(book.forecastReason);if(!positive.length)positive.push('Есть частичное совпадение с общим профилем чтения.');
    if(!risks.length){if(confidence==='Низкая')risks.push('Мало похожих прочитанных книг, поэтому прогноз приблизительный.');else risks.push('Главный риск — внешние признаки книги могут не отражать темп и качество реализации.');}
    return {score,low:roundHalf(clamp(score-range,1,5)),high:roundHalf(clamp(score+range,1,5)),probability,confidence,positive:unique(positive).slice(0,4),risks:unique(risks).slice(0,3),explanation:factors.join(' ')||'Прогноз основан на общей истории оценок.',confidenceReason:confidence==='Высокая'?'достаточно похожих книг и личных сигналов':confidence==='Средняя'?'есть несколько релевантных сигналов':'похожих данных пока мало'};
  }
  function recalculateAll(recordChanges){
    state.books.filter(b=>b.status==='want').forEach(b=>{
      const old=b.forecast?.score; const next=calculateForecast(b); b.forecast=next;
      if(recordChanges&&old!=null&&Math.abs(next.score-old)>=.1){b.lastForecastChange=round1(next.score-old);b.forecastHistory.push({date:new Date().toISOString(),score:next.score,previous:old,reason:'Обновлены оценки, впечатления или признаки профиля.'});}
    });
  }
  function refreshNow(){recalculateAll(true);state.meta.lastExternalUpdate=new Date().toISOString();save();toast('Прогнозы пересчитаны. Внешние оценки обновятся после нового импорта.');render()}
  function maybeWeeklyRefresh(){const last=state.meta.lastExternalUpdate?new Date(state.meta.lastExternalUpdate):null;if(!last||Date.now()-last.getTime()>7*864e5){recalculateAll(true);state.meta.lastExternalUpdate=new Date().toISOString();save();}}

  function openImport(){
    openModal(`<button class="import-choice" data-import="excel"><span class="import-icon">▦</span><span><b>Excel-файл</b><small>LiveLib или таблица Яндекс Книг с названием и автором</small></span></button>
      <button class="import-choice" data-import="link"><span class="import-icon">↗</span><span><b>Вставить ссылку</b><small>LiveLib или Яндекс Книги</small></span></button>
      <button class="import-choice" data-import="screenshot"><span class="import-icon">▧</span><span><b>Скриншот списка</b><small>Распознавание текста с обязательной проверкой</small></span></button>
      <button class="import-choice" data-import="json"><span class="import-icon">⤒</span><span><b>Резервная копия JSON</b><small>Восстановление ранее сохранённых данных</small></span></button>
      <button class="import-choice" data-import="manual"><span class="import-icon">＋</span><span><b>Добавить вручную</b><small>Название, автор, даты и оценки</small></span></button>
      <div class="warning small">На iPhone PWA пока не может надёжно появляться отдельным получателем в меню «Поделиться». Для Яндекс Книг используй «Скопировать ссылку» и вставку ссылки.</div>`, 'Импорт книг');
    document.querySelectorAll('[data-import]').forEach(b=>b.addEventListener('click',()=>{const a=b.dataset.import;if(a==='excel')openExcelImport();if(a==='link')openLinkImport();if(a==='screenshot')openScreenshotImport();if(a==='json')openJsonImport();if(a==='manual')openAddBook()}));
  }
  function openExcelImport(){
    openModal(`<div class="drop-zone"><p><strong>Выбери .xlsx, .xls или .csv</strong></p><input type="file" id="excelFile" accept=".xlsx,.xls,.csv"></div><p class="muted small">Приложение ищет строку заголовков с колонками «Книга» и «Автор». Даты добавления и прочтения импортируются, если присутствуют.</p><div id="excelStatus"></div>`, 'Импорт Excel');
    document.getElementById('excelFile').addEventListener('change',handleExcelFile);
  }
  async function handleExcelFile(e){
    const file=e.target.files?.[0];if(!file)return;const status=document.getElementById('excelStatus');status.innerHTML='<p>Читаю файл…</p>';
    try{if(!window.XLSX)throw new Error('Библиотека Excel не загрузилась. Проверь интернет.');const buf=await file.arrayBuffer();const wb=XLSX.read(buf,{type:'array',cellDates:true});let drafts=[];wb.SheetNames.forEach(name=>{const rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:''});drafts.push(...parseTableRows(rows,file.name,name))});drafts=dedupeDrafts(drafts);showImportReview(drafts,`Excel: ${file.name}`)}catch(err){status.innerHTML=`<div class="warning">${escapeHtml(err.message)}</div>`}
  }
  function parseTableRows(rows,fileName,sheetName){
    let hi=rows.findIndex(r=>r.some(c=>normalize(c)==='книга')&&r.some(c=>normalize(c)==='автор'));if(hi<0)return[];const headers=rows[hi].map(c=>String(c).trim());const idx=(patterns)=>headers.findIndex(h=>patterns.some(p=>normalize(h).includes(normalize(p))));
    const titleI=idx(['Книга','Название']),authorI=idx(['Автор']),mineI=idx(['Моя оценка']),liveI=idx(['Средняя оценка LiveLib','Средняя LiveLib']),yanI=idx(['Яндекс']),readI=idx(['Дата прочтения']),wantI=idx(['Дата добавления']),catI=idx(['Категория','Жанр']),forecastI=idx(['Прогноз твоей оценки']),reasonI=idx(['Почему так']),linkI=idx(['Ссылка']);
    return rows.slice(hi+1).filter(r=>r[titleI]&&r[authorI]).map(r=>{const status=(mineI>=0&&r[mineI]!==''||readI>=0&&r[readI])?'read':'want';return{id:`imp_${Date.now()}_${Math.random().toString(36).slice(2)}`,status,title:String(r[titleI]).trim(),author:String(r[authorI]).trim(),myRating:numOrNull(r[mineI]),livelibRating:numOrNull(r[liveI]),yandexRating:numOrNull(r[yanI]),readDate:parseDate(r[readI]),addedWantDate:parseDate(r[wantI]),addedAppDate:TODAY,category:catI>=0?String(r[catI]||'').trim():'',forecastSeed:numOrNull(r[forecastI]),forecastReason:reasonI>=0?String(r[reasonI]||'').trim():'',sourceUrl:linkI>=0?String(r[linkI]||'').trim():'',source:'Импорт Excel',format:'text',importSource:`${fileName} / ${sheetName}`}});
  }
  function showImportReview(drafts,label){
    const matches=drafts.map(d=>({draft:d,existing:findDuplicate(d)}));const duplicateCount=matches.filter(x=>x.existing).length;
    openModal(`<div class="import-report"><div class="report-box"><strong>${drafts.length}</strong><small>распознано</small></div><div class="report-box"><strong>${duplicateCount}</strong><small>возможных дублей</small></div></div><p class="muted small">Источник: ${escapeHtml(label)}. Перед сохранением возможные дубли объединяются только после подтверждения.</p><div class="book-list" style="max-height:45vh;overflow:auto">${matches.slice(0,80).map((x,i)=>`<div class="card" style="padding:11px"><strong>${escapeHtml(x.draft.title)}</strong><div class="muted small">${escapeHtml(x.draft.author)} · ${x.draft.status==='read'?'Прочитано':'Хочу'}</div>${x.existing?`<label class="check-pill" style="margin-top:7px"><input type="checkbox" data-merge="${i}" checked>Объединить с существующей записью</label>`:''}</div>`).join('')}</div><button class="primary full" id="saveImport" style="margin-top:12px">Сохранить результат</button>`, 'Проверка импорта');
    document.getElementById('saveImport').addEventListener('click',()=>{let added=0,merged=0;matches.forEach((x,i)=>{const merge=document.querySelector(`[data-merge="${i}"]`)?.checked;if(x.existing&&merge){mergeBook(x.existing,x.draft);merged++}else{state.books.push(x.draft);added++}});state.meta.isDemo=false;recalculateAll(true);save();closeModal();toast(`Добавлено: ${added}, объединено: ${merged}`);render()});
  }
  function findDuplicate(d){return state.books.find(b=>normalize(b.title)===normalize(d.title)&&normalize(b.author)===normalize(d.author))}
  function mergeBook(a,b){Object.keys(b).forEach(k=>{if((a[k]==null||a[k]==='')&&b[k]!=null&&b[k]!=='')a[k]=b[k]});a.source=[a.source,b.source].filter(Boolean).join(' + ');a.needsReview=false}
  function dedupeDrafts(a){const m=new Map();a.forEach(x=>m.set(`${normalize(x.title)}|${normalize(x.author)}`,x));return[...m.values()]}

  function openLinkImport(){
    openModal(`<div class="field"><label>Ссылка на книгу</label><input id="importUrl" placeholder="https://..."></div><div class="field"><label>Название</label><input id="importTitle"></div><div class="field"><label>Автор</label><input id="importAuthor"></div><p class="muted small">Без серверной интеграции приложение не может надёжно получить карточку сайта, поэтому название и автора нужно проверить.</p><button class="primary full" id="saveLink">Продолжить</button>`, 'Добавить по ссылке');
    document.getElementById('importUrl').addEventListener('input',e=>{const guess=guessFromUrl(e.target.value);if(guess){document.getElementById('importTitle').value ||= guess}});
    document.getElementById('saveLink').addEventListener('click',()=>{const url=document.getElementById('importUrl').value.trim(),title=document.getElementById('importTitle').value.trim(),author=document.getElementById('importAuthor').value.trim();if(!title||!author){toast('Укажи название и автора');return}state.books.push({id:`b_${Date.now()}`,status:'want',title,author,sourceUrl:url,source:url.includes('livelib')?'LiveLib':url.includes('yandex')?'Яндекс Книги':'Ссылка',addedWantDate:TODAY,addedAppDate:TODAY,format:'text',needsReview:true,forecastHistory:[]});recalculateAll(true);save();closeModal();toast('Книга добавлена для проверки');navigate('want')});
  }
  function openScreenshotImport(){
    openModal(`<div class="drop-zone"><input type="file" id="shotFile" accept="image/*"><p class="muted small">Распознавание выполняется в браузере и может занять время. Результат обязательно проверь.</p></div><div id="ocrProgress"></div><div class="field"><label>Распознанный текст</label><textarea class="ocr-output" id="ocrText" placeholder="После распознавания здесь появится текст. Можно также вставить его вручную."></textarea></div><p class="muted small">Для простого разбора располагай название и автора на соседних строках. Нечётные строки считаются названиями, следующие — авторами.</p><button class="primary full" id="parseOcr">Создать черновики</button>`, 'Скриншот списка');
    document.getElementById('shotFile').addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;const p=document.getElementById('ocrProgress');try{if(!window.Tesseract)throw new Error('Модуль OCR не загрузился. Проверь интернет.');p.innerHTML='<p>Распознаю изображение…</p>';const r=await Tesseract.recognize(f,'rus+eng',{logger:m=>{if(m.progress)p.innerHTML=`<p>${escapeHtml(m.status)} — ${Math.round(m.progress*100)}%</p>`}});document.getElementById('ocrText').value=r.data.text;p.innerHTML='<div class="success">Текст распознан. Проверь строки.</div>'}catch(err){p.innerHTML=`<div class="warning">${escapeHtml(err.message)}</div>`}});
    document.getElementById('parseOcr').addEventListener('click',()=>{const lines=document.getElementById('ocrText').value.split('\n').map(x=>x.trim()).filter(x=>x.length>2);const drafts=[];for(let i=0;i<lines.length;i+=2){drafts.push({id:`ocr_${Date.now()}_${i}`,status:'want',title:lines[i],author:lines[i+1]||'Автор не распознан',addedWantDate:TODAY,addedAppDate:TODAY,format:'text',source:'Скриншот',needsReview:true,forecastHistory:[]})}showImportReview(drafts,'Скриншот')});
  }
  function openJsonImport(){
    openModal(`<div class="drop-zone"><input type="file" id="jsonFile" accept="application/json,.json"></div><div id="jsonStatus"></div>`, 'Восстановление копии');
    document.getElementById('jsonFile').addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;try{const data=JSON.parse(await f.text());if(!Array.isArray(data.books))throw new Error('В файле нет списка books.');if(confirm(`Заменить текущие данные? В копии ${data.books.length} книг.`)){Object.keys(state).forEach(k=>delete state[k]);Object.assign(state,data);normalizeState();closeModal();toast('Резервная копия восстановлена');render()}}catch(err){document.getElementById('jsonStatus').innerHTML=`<div class="warning">${escapeHtml(err.message)}</div>`}});
  }
  function exportBackup(){
    state.meta.lastBackup=new Date().toISOString();save();const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});downloadBlob(blob,`book-predictor-backup-${TODAY}.json`);toast('Резервная копия создана')
  }

  function openGlobalSearch(){
    openModal(`<div class="searchbox"><input id="globalSearch" placeholder="Название, автор, серия, жанр" autofocus></div><div id="globalResults" class="book-list" style="margin-top:12px"></div>`, 'Поиск');
    const input=document.getElementById('globalSearch'),out=document.getElementById('globalResults');const run=()=>{const q=input.value.toLowerCase().trim();const books=state.books.filter(b=>!q||`${b.title} ${b.author} ${b.category||''} ${b.series||''}`.toLowerCase().includes(q)).slice(0,40);out.innerHTML=books.map(b=>bookRow(b)).join('')||empty('Ничего не найдено');out.querySelectorAll('[data-book-id]').forEach(r=>r.addEventListener('click',()=>openBook(r.dataset.bookId)))};input.addEventListener('input',run);run();
  }
  function openSettings(){
    openModal(`<div class="settings-list">
      <div class="settings-item"><div><strong>Обновить прогнозы</strong><small>Последний пересчёт: ${state.meta.lastExternalUpdate?formatDateTime(state.meta.lastExternalUpdate):'нет данных'}</small></div><button class="secondary" id="settingsRefresh">Обновить</button></div>
      <div class="settings-item"><div><strong>Резервная копия</strong><small>Последняя: ${state.meta.lastBackup?formatDateTime(state.meta.lastBackup):'не создавалась'}</small></div><button class="secondary" id="settingsBackup">Создать</button></div>
      <div class="settings-item"><div><strong>Импорт данных</strong><small>Excel, ссылка, скриншот или JSON</small></div><button class="secondary" id="settingsImport">Открыть</button></div>
      <div class="settings-item"><div><strong>Скрытые книги</strong><small>${state.hiddenIds.length} записей</small></div><button class="secondary" id="settingsHidden">Показать</button></div>
      <div class="settings-item"><div><strong>Демо-данные</strong><small>Вернуть стартовую выборку</small></div><button class="danger" id="settingsReset">Сбросить</button></div>
    </div><div class="divider"></div><p class="muted small">Версия ${APP_VERSION}. Данные хранятся в браузере. Регулярно создавай резервную копию и сохраняй её в iCloud Drive или «Файлы».</p>`, 'Настройки');
    document.getElementById('settingsRefresh').onclick=()=>{closeModal();refreshNow()};document.getElementById('settingsBackup').onclick=exportBackup;document.getElementById('settingsImport').onclick=openImport;document.getElementById('settingsHidden').onclick=openHidden;document.getElementById('settingsReset').onclick=()=>{if(confirm('Удалить текущие данные и вернуть демонстрационную выборку?')){localStorage.removeItem(STORAGE_KEY);location.reload()}};
  }
  function openHidden(){const books=state.books.filter(b=>state.hiddenIds.includes(b.id));openModal(`<div class="book-list">${books.map(b=>`<div class="settings-item"><div><strong>${escapeHtml(b.title)}</strong><small>${escapeHtml(b.author)}</small></div><button class="secondary" data-restore="${b.id}">Вернуть</button></div>`).join('')||empty('Скрытых книг нет')}</div>`,'Скрытые книги');document.querySelectorAll('[data-restore]').forEach(x=>x.onclick=()=>{state.hiddenIds=state.hiddenIds.filter(id=>id!==x.dataset.restore);save();openHidden();render()})}

  function openModal(html,title=''){els.modal.innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true"><div class="modal-header"><h2>${escapeHtml(title)}</h2><button class="close" aria-label="Закрыть">×</button></div>${html}</section></div>`;els.modal.querySelector('.close').onclick=closeModal;els.modal.querySelector('.modal-backdrop').addEventListener('click',e=>{if(e.target.classList.contains('modal-backdrop'))closeModal()});}
  function closeModal(){els.modal.innerHTML=''}
  function bindModalAction(action,fn){els.modal.querySelector(`[data-modal-action="${action}"]`)?.addEventListener('click',fn)}
  function toast(text){const t=document.createElement('div');t.className='toast';t.textContent=text;els.toast.append(t);setTimeout(()=>t.remove(),3200)}

  function handleSharedUrl(){const p=new URLSearchParams(location.search);const url=p.get('url')||p.get('share_url');if(url){setTimeout(()=>{openLinkImport();const el=document.getElementById('importUrl');if(el)el.value=url},300);history.replaceState({},'',location.pathname)}}
  function registerServiceWorker(){if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(console.warn)}

  function ratingOptions(selected){const a=[];for(let x=1;x<=5;x+=.5)a.push(`<option value="${x}" ${Number(selected)===x?'selected':''}>${formatScore(x)}</option>`);return a.join('')}
  function findRatingSource(b){return [b.livelibRating,b.yandexRating].filter(Number.isFinite)}
  function confidenceRank(c){return c==='Высокая'?3:c==='Средняя'?2:1}
  function confidenceClass(c){return c==='Высокая'?'good':c==='Средняя'?'medium':'risk'}
  function numOrNull(v){if(v===null||v===undefined||v==='')return null;const n=Number(String(v).trim().replace(',','.'));return Number.isFinite(n)?n:null}
  function localDateString(d){
    if(!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function dateVal(v){const iso=parseDate(v);if(!iso)return 0;const d=new Date(`${iso}T00:00:00`);return Number.isNaN(d.getTime())?0:d.getTime()}
  function getYear(v){const iso=parseDate(v);return iso?Number(iso.slice(0,4)):null}
  function formatDate(v){const iso=parseDate(v);if(!iso)return v?String(v):'';const [y,m,d]=iso.split('-').map(Number);return new Intl.DateTimeFormat('ru-RU').format(new Date(y,m-1,d))}
  function formatDateTime(v){const d=new Date(v);return Number.isNaN(d.getTime())?'нет данных':new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'short'}).format(d)}
  function parseDate(v){
    if(v===null||v===undefined||v==='') return null;
    if(v instanceof Date) return localDateString(v);
    if(typeof v==='number' && Number.isFinite(v)){
      // Excel хранит даты как число дней с конца 1899 года.
      if(v>=1900 && v<=2100 && Number.isInteger(v)) return `${v}-01-01`;
      if(v>0 && v<100000){
        const parsed=window.XLSX?.SSF?.parse_date_code?.(v);
        if(parsed?.y&&parsed?.m&&parsed?.d) return `${parsed.y}-${String(parsed.m).padStart(2,'0')}-${String(parsed.d).padStart(2,'0')}`;
        const utc=new Date(Date.UTC(1899,11,30)+Math.round(v)*86400000);
        if(!Number.isNaN(utc.getTime())) return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth()+1).padStart(2,'0')}-${String(utc.getUTCDate()).padStart(2,'0')}`;
      }
      return null;
    }
    const s=String(v).trim();
    if(!s || /^(invalid date|nan|null|undefined)$/i.test(s)) return null;
    let m=s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
    if(m) return validIso(Number(m[1]),Number(m[2]),Number(m[3]));
    m=s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if(m){
      const a=Number(m[1]),b=Number(m[2]),y=Number(m[3]);
      return b>12&&a<=12 ? validIso(y,a,b) : validIso(y,b,a);
    }
    m=s.match(/^(\d{1,2})[./-](\d{4})$/);
    if(m) return validIso(Number(m[2]),Number(m[1]),1);
    if(/^\d{4}$/.test(s)) return validIso(Number(s),1,1);
    const monthStems={январ:1,феврал:2,март:3,апрел:4,май:5,мая:5,июн:6,июл:7,август:8,сентябр:9,октябр:10,ноябр:11,декабр:12};
    m=s.toLowerCase().match(/(?:(\d{1,2})\s+)?(январ[а-яё]*|феврал[а-яё]*|март[а-яё]*|апрел[а-яё]*|ма[йя]|июн[а-яё]*|июл[а-яё]*|август[а-яё]*|сентябр[а-яё]*|октябр[а-яё]*|ноябр[а-яё]*|декабр[а-яё]*)\s+(\d{4})/);
    if(m){const stem=Object.keys(monthStems).find(k=>m[2].startsWith(k));return validIso(Number(m[3]),monthStems[stem]||1,Number(m[1]||1));}
    const d=new Date(s);
    return Number.isNaN(d.getTime())?null:localDateString(d);
  }
  function validIso(y,m,d){
    if(!Number.isInteger(y)||!Number.isInteger(m)||!Number.isInteger(d)||y<1000||m<1||m>12||d<1||d>31)return null;
    const x=new Date(y,m-1,d);
    return x.getFullYear()===y&&x.getMonth()===m-1&&x.getDate()===d?localDateString(x):null;
  }
  function formatScore(v){return Number(v).toFixed(Number(v)%1===0?1:1).replace('.',',')}
  function round1(v){return Math.round(v*10)/10}function roundHalf(v){return Math.round(v*2)/2}function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
  function average(a){return a.length?a.reduce((s,x)=>s+Number(x||0),0)/a.length:0}function weightedAverage(a){const w=a.reduce((s,x)=>s+(x.w||0),0);return w?a.reduce((s,x)=>s+x.v*x.w,0)/w:0}function pct(a,b){return b?Math.round(a/b*100):0}
  function recencyWeight(date){if(!date)return .75;const years=Math.max(0,(Date.now()-dateVal(date))/(365.25*864e5));return .55+.45*Math.exp(-years/3)}
  function normalize(s){return String(s||'').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/gi,' ').trim()}
  function tokenize(s){return new Set(normalize(s).split(' ').filter(x=>x.length>2))}function overlap(a,b){if(!a.size||!b.size)return 0;let n=0;a.forEach(x=>{if(b.has(x))n++});return n/Math.max(a.size,b.size)}
  function unique(a){return [...new Set(a)]}function shortTitle(t){const w=String(t).split(/\s+/).slice(0,4).join(' ');return w.length>45?w.slice(0,44)+'…':w}
  function guessFromUrl(u){try{const slug=new URL(u).pathname.split('/').filter(Boolean).at(-1)||'';return slug.replace(/^\d+-/,'').split('-').slice(0,-2).join(' ').replace(/\b\w/g,x=>x.toUpperCase())}catch{return''}}
  function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},200)}
  function escapeHtml(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}function escapeAttr(s){return escapeHtml(s)}
  function debounce(fn,ms){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}}
})();
