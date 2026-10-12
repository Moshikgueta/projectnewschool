/* Teacher onboarding — the end-to-end path from the brief's success
   criteria, run against the same local Worker as the rest of the suite:

     a manager builds a path, adds modules, assigns it to a teacher; the
     teacher signs in, works through it, answers and submits; the manager sees
     the progress, reviews, approves, records readiness, and adds a follow-on
     training afterwards.

   Plus the edges the brief names: a teacher with no training, an
   unauthorised user, a stale editor, content changing mid-training, a
   refresh (state comes back from the server), and a failed save. */

export async function trainingSuite({ call, ok, admin, student }) {
  const T = '/api/staff/training';
  let r;

  console.log('\nTraining · accounts');
  const mk = async (name, user, role) => {
    const c = await call('/api/staff/users', { method: 'POST', cookie: admin, body: { name, user, email: user + '@newschool.co.il', role } });
    const login = await call('/api/staff/auth/login', { method: 'POST', body: { user, pass: c.body.tempPassword } });
    return { id: c.body.user.id, cookie: login.cookie };
  };
  const ped = await mk('מושיק גואטה', 'moshik', 'מנהל פדגוגי');
  const dana = await mk('דנה לוי', 'dana', 'מורה');
  const vet = await mk('רבקה ותיקה', 'rivka', 'מורה');
  const recep = await mk('מיכל קבלה', 'michal', 'מנהלת קבלה');
  ok('test accounts sign in', !!(ped.cookie && dana.cookie && vet.cookie && recep.cookie));

  console.log('\nTraining · who may do what');
  ok('signed out → 401', (await call(T + '/admin/overview')).status === 401);
  ok('a teacher cannot open management', (await call(T + '/admin/overview', { cookie: dana.cookie })).status === 403);
  ok('reception cannot open management', (await call(T + '/modules', { cookie: recep.cookie })).status === 403);
  ok('a student cannot open the hub', (await call(T + '/resources', { cookie: student })).status === 403);
  ok('a student has no training area', (await call(T + '/me', { cookie: student })).status === 403);
  ok('the pedagogical manager can manage', (await call(T + '/admin/overview', { cookie: ped.cookie })).body.ok === true);
  ok('so can the office admin', (await call(T + '/admin/overview', { cookie: admin })).body.ok === true);
  r = await call(T + '/me', { cookie: vet.cookie });
  ok('a teacher with no training sees none', r.body.ok === true && r.body.assignments.length === 0);
  ok('a teacher cannot create modules', (await call(T + '/modules', { method: 'POST', cookie: dana.cookie, body: { title: 'x' } })).status === 403);
  ok('unknown training route 404s', (await call(T + '/nope', { cookie: ped.cookie })).status === 404);

  console.log('\nTraining · template');
  r = await call(T + '/admin/template', { method: 'POST', cookie: ped.cookie, body: {} });
  ok('template seeds 12 draft modules and 8 resources', r.body.modules === 12 && r.body.resources === 8, JSON.stringify(r.body));
  r = await call(T + '/admin/template', { method: 'POST', cookie: ped.cookie, body: {} });
  ok('seeding twice adds nothing', r.body.modules === 0 && r.body.resources === 0);
  r = await call(T + '/modules', { cookie: ped.cookie });
  ok('template modules are drafts', r.body.modules.length === 12 && r.body.modules.every(m => m.status === 'draft'));
  r = await call(T + '/resources', { cookie: ped.cookie });
  ok('sample resources are drafts, unchecked', r.body.resources.length === 8 && r.body.resources.every(x => x.status === 'draft' && x.linkStatus === 'unchecked'));
  ok('general and Italian-specific are told apart', r.body.resources.filter(x => x.language === 'איטלקית').length === 2);
  ok('teachers do not see draft resources', (await call(T + '/resources', { cookie: dana.cookie })).body.resources.length === 0);

  console.log('\nTraining · building modules');
  r = await call(T + '/modules', {
    method: 'POST', cookie: ped.cookie, body: {
      title: 'מודול בדיקה א', description: 'תיאור', objectives: ['מטרה 1', 'מטרה 2'], estMinutes: 20,
      blocks: [
        { type: 'heading', text: 'פתיחה' },
        { type: 'text', body: 'פסקה ראשונה\n- נקודה' },
        { type: 'link', url: 'javascript:alert(1)', label: 'רע' },
        { type: 'mcq', question: 'כמה זה 2+2?', maxAttempts: 2, options: [{ text: '3' }, { text: '4', correct: true }, { text: '5' }] },
        { type: 'order', prompt: 'סדרו', items: [{ text: 'ראשון' }, { text: 'שני' }, { text: 'שלישי' }] },
        { type: 'match', prompt: 'התאימו', pairs: [{ left: 'Zoom', right: 'וידאו' }, { left: 'Quizlet', right: 'כרטיסיות' }] },
        { type: 'scenario', situation: 'מצב', considerations: 'שיקולים', options: [{ text: 'א', quality: 'recommended', feedback: 'טוב' }, { text: 'ב', quality: 'problematic', feedback: 'פחות' }] },
        { type: 'checklist', title: 'רשימה', items: [{ text: 'אחד' }, { text: 'שניים' }] },
        { type: 'open', prompt: 'ספרו', review: true },
        { type: 'nonsense', foo: 1 }
      ]
    }
  });
  const modA = r.body.module;
  ok('module created as a draft', r.status === 201 && modA.status === 'draft' && modA.rev === 1);
  ok('unknown block types are dropped', modA.blocks.length === 9);
  ok('javascript: links are stripped', modA.blocks[2].url === '');
  ok('every block and item gets an id', modA.blocks.every(b => b.id) && modA.blocks[3].options.every(o => o.id));
  ok('activities default to required', modA.blocks[3].required === true);

  r = await call(T + '/modules', { method: 'POST', cookie: ped.cookie, body: { title: 'מודול בדיקה ב', blocks: [{ type: 'reflection', prompt: 'מה למדת?' }] } });
  const modB = r.body.module;
  ok('reflection defaults to no review', modB.blocks[0].review === false);
  r = await call(T + '/modules', { method: 'POST', cookie: ped.cookie, body: { title: 'מודול בדיקה ג (רשות)', blocks: [{ type: 'text', body: 'קריאה בלבד' }] } });
  const modC = r.body.module;

  r = await call(T + '/modules/' + modA.id, { method: 'PATCH', cookie: ped.cookie, body: { rev: 1, title: 'מודול בדיקה א', blocks: modA.blocks } });
  ok('saving a draft bumps rev', r.body.ok && r.body.module.rev === 2);
  r = await call(T + '/modules/' + modA.id, { method: 'PATCH', cookie: ped.cookie, body: { rev: 1, title: 'עריכה ישנה' } });
  ok('a stale editor is refused, not overwritten', r.status === 409 && r.body.conflict === true && r.body.module.title === 'מודול בדיקה א');
  r = await call(T + '/modules/' + modA.id + '/versions', { cookie: ped.cookie });
  ok('every save is kept as a version', r.body.versions.length === 2);

  console.log('\nTraining · path and assignment');
  r = await call(T + '/paths', {
    method: 'POST', cookie: ped.cookie, body: {
      title: 'מסלול בדיקה', kind: 'onboarding', language: 'איטלקית',
      modules: [{ moduleId: modA.id }, { moduleId: modB.id, prereq: modA.id }, { moduleId: modC.id, required: false }, { moduleId: modA.id }]
    }
  });
  const path = r.body.path;
  ok('path created with three modules in order', r.status === 201 && path.modules.length === 3 && path.modules[1].prereq === modA.id);
  ok('optional module stays optional', path.modules[2].required === false);

  r = await call(T + '/assignments', { method: 'POST', cookie: ped.cookie, body: { userId: recep.id, pathId: path.id } });
  ok('only teacher accounts can be assigned', r.status === 400);
  r = await call(T + '/assignments', { method: 'POST', cookie: ped.cookie, body: { userId: dana.id, pathId: path.id, dueDate: '2026-12-01' } });
  const asg = r.body.id;
  ok('path assigned to a teacher', r.status === 201 && !!asg);
  ok('assigning twice is refused', (await call(T + '/assignments', { method: 'POST', cookie: ped.cookie, body: { userId: dana.id, pathId: path.id } })).status === 409);
  await call(T + '/admin/learners/' + dana.id + '/profile', { method: 'PUT', cookie: ped.cookie, body: { language: 'איטלקית', position: 'מורה פרטית', startDate: '2026-10-12' } });

  r = await call(T + '/me', { cookie: dana.cookie });
  ok('the teacher sees her path', r.body.assignments.length === 1 && r.body.assignments[0].pathTitle === 'מסלול בדיקה');
  ok('and her profile', r.body.profile.language === 'איטלקית' && r.body.profile.startDate === '2026-10-12');
  ok('unpublished modules are not available to her', r.body.assignments[0].modules.every(m => !m.available));
  ok('she was notified', r.body.unread >= 1 && r.body.notifications.some(n => n.kind === 'assigned'));
  ok('drafts cannot be opened', (await call(T + '/me/modules/' + modA.id + '?assignment=' + asg, { cookie: dana.cookie })).status === 403);
  ok('another teacher cannot use her assignment', (await call(T + '/me/modules/' + modA.id + '?assignment=' + asg, { cookie: vet.cookie })).status === 404);

  for (const m of [modA, modB, modC]) await call(T + '/modules/' + m.id + '/publish', { method: 'POST', cookie: ped.cookie, body: {} });
  r = await call(T + '/me', { cookie: dana.cookie });
  const mods = r.body.assignments[0].modules;
  ok('published modules become available', mods.every(m => m.available));
  ok('the second module is locked behind the first', mods[1].locked === true && mods[1].state.status === 'locked');
  ok('a locked module cannot be opened', (await call(T + '/me/modules/' + modB.id + '?assignment=' + asg, { cookie: dana.cookie })).status === 403);

  console.log('\nTraining · the teacher works');
  r = await call(T + '/me/modules/' + modA.id + '?assignment=' + asg, { cookie: dana.cookie });
  let mod = r.body.module;
  const blk = (type) => mod.blocks.find(x => x.block.type === type).block;
  ok('module opens for her', r.body.ok && mod.state.status === 'not_started');
  ok('the answer key is not sent', !JSON.stringify(blk('mcq')).includes('correct') && !JSON.stringify(blk('scenario')).includes('recommended'));
  ok('match rights are not paired with ids', blk('match').rights.length === 2 && !blk('match').key);
  const mcq = blk('mcq');
  r = await call(T + '/me/progress', { method: 'POST', cookie: dana.cookie, body: { assignmentId: asg, moduleId: modA.id, action: 'viewed' } });
  ok('marking the material as read is recorded', r.body.module.viewed === true && r.body.module.state.status === 'in_progress');
  r = await call(T + '/me/progress', { method: 'POST', cookie: dana.cookie, body: { assignmentId: asg, moduleId: modA.id, blockId: mcq.id, action: 'answer', answer: { selected: [mcq.options[0].id] } } });
  let entry = r.body.module.blocks.find(x => x.block.id === mcq.id);
  ok('a wrong answer is graded wrong and stays open', entry.progress.correct === false && entry.progress.state !== 'done' && !entry.block.options[0].hasOwnProperty('correct'));
  r = await call(T + '/me/progress', { method: 'POST', cookie: dana.cookie, body: { assignmentId: asg, moduleId: modA.id, blockId: mcq.id, action: 'answer', answer: { selected: [mcq.options[1].id] } } });
  entry = r.body.module.blocks.find(x => x.block.id === mcq.id);
  ok('the right answer completes it and reveals the key', entry.progress.correct === true && entry.progress.state === 'done' && entry.block.options[1].correct === true);
  ok('a finished item cannot be re-answered', (await call(T + '/me/progress', { method: 'POST', cookie: dana.cookie, body: { assignmentId: asg, moduleId: modA.id, blockId: mcq.id, action: 'answer', answer: { selected: [mcq.options[1].id] } } })).status === 409);

  const ord = blk('order');
  /* The shuffle is sent; the true order is ראשון, שני, שלישי. */
  const want = ['ראשון', 'שני', 'שלישי'].map(t => ord.items.find(i => i.text === t).id);
  ok('ordering items arrive shuffled', ord.items.map(i => i.id).join() !== want.join());
  r = await call(T + '/me/progress', { method: 'POST', cookie: dana.cookie, body: { assignmentId: asg, moduleId: modA.id, blockId: ord.id, action: 'answer', answer: { order: want } } });
  ok('the order is graded server-side', r.body.module.blocks.find(x => x.block.id === ord.id).progress.correct === true);

  const mt = blk('match');
  const map = {}; mt.lefts.forEach(l => { map[l.id] = l.text === 'Zoom' ? 'וידאו' : 'כרטיסיות'; });
  r = await call(T + '/me/progress', { method: 'POST', cookie: dana.cookie, body: { assignmentId: asg, moduleId: modA.id, blockId: mt.id, action: 'answer', answer: { map } } });
  ok('matching is graded', r.body.module.blocks.find(x => x.block.id === mt.id).progress.correct === true);

  const sc = blk('scenario');
  r = await call(T + '/me/progress', { method: 'POST', cookie: dana.cookie, body: { assignmentId: asg, moduleId: modA.id, blockId: sc.id, action: 'answer', answer: { choice: sc.options[1].id } } });
  entry = r.body.module.blocks.find(x => x.block.id === sc.id);
  ok('a scenario choice completes it and reveals every option\'s reasoning', entry.progress.state === 'done' && entry.block.options.every(o => o.feedback) && entry.block.considerations === 'שיקולים');

  const ck = blk('checklist');
  r = await call(T + '/me/progress', { method: 'POST', cookie: dana.cookie, body: { assignmentId: asg, moduleId: modA.id, blockId: ck.id, action: 'answer', answer: { checked: [ck.items[0].id] } } });
  ok('a half-ticked checklist is not done', r.body.module.blocks.find(x => x.block.id === ck.id).progress.state !== 'done');
  r = await call(T + '/me/progress', { method: 'POST', cookie: dana.cookie, body: { assignmentId: asg, moduleId: modA.id, blockId: ck.id, action: 'answer', answer: { checked: ck.items.map(i => i.id) } } });
  ok('a fully ticked checklist is done', r.body.module.blocks.find(x => x.block.id === ck.id).progress.state === 'done');

  const op = blk('open');
  ok('an empty submission is refused', (await call(T + '/me/submit', { method: 'POST', cookie: dana.cookie, body: { assignmentId: asg, moduleId: modA.id, blockId: op.id, body: { text: '' } } })).status === 400);
  r = await call(T + '/me/submit', { method: 'POST', cookie: dana.cookie, body: { assignmentId: asg, moduleId: modA.id, blockId: op.id, body: { text: 'התשובה שלי' } } });
  ok('submitting puts the module in review, not complete', r.body.module.state.status === 'pending_review');
  ok('a pending submission cannot be resent', (await call(T + '/me/submit', { method: 'POST', cookie: dana.cookie, body: { assignmentId: asg, moduleId: modA.id, blockId: op.id, body: { text: 'שוב' } } })).status === 409);

  /* Refresh: everything above comes back from the server, not the page. */
  r = await call(T + '/me', { cookie: dana.cookie });
  ok('after a refresh the progress is still there', r.body.assignments[0].modules[0].state.status === 'pending_review' && r.body.assignments[0].lastModuleId === modA.id);
  ok('walking through screens did not make her ready', r.body.assignments[0].readiness === null);

  console.log('\nTraining · the manager reviews');
  r = await call(T + '/admin/overview', { cookie: ped.cookie });
  ok('overview counts one teacher in training', r.body.stats.inTraining === 1);
  ok('and one item to review', r.body.stats.toReview === 1 && r.body.queue[0].name === 'דנה לוי');
  const subId = r.body.queue[0].id;
  r = await call(T + '/admin/learners/' + dana.id, { cookie: ped.cookie });
  ok('the learner profile shows answers with the key', r.body.assignments[0].detail[modA.id].find(x => x.block.type === 'mcq').progress.attempts === 2);
  ok('the submission is readable', r.body.assignments[0].detail[modA.id].find(x => x.block.type === 'open').history[0].body.text === 'התשובה שלי');
  ok('a teacher cannot review', (await call(T + '/submissions/' + subId + '/review', { method: 'POST', cookie: dana.cookie, body: { decision: 'approve' } })).status === 403);
  ok('revision needs a reason', (await call(T + '/submissions/' + subId + '/review', { method: 'POST', cookie: ped.cookie, body: { decision: 'revise' } })).status === 400);
  r = await call(T + '/submissions/' + subId + '/review', { method: 'POST', cookie: ped.cookie, body: { decision: 'revise', feedback: 'להרחיב בבקשה' } });
  ok('revision requested', r.body.ok === true);
  r = await call(T + '/me', { cookie: dana.cookie });
  ok('she sees "needs revision" and the feedback note', r.body.assignments[0].modules[0].state.status === 'needs_revision' && r.body.notifications.some(n => n.kind === 'revision' && n.body === 'להרחיב בבקשה'));
  r = await call(T + '/me/submit', { method: 'POST', cookie: dana.cookie, body: { assignmentId: asg, moduleId: modA.id, blockId: op.id, body: { text: 'התשובה המורחבת שלי' } } });
  ok('she resubmits', r.body.ok && r.body.module.blocks.find(x => x.block.id === op.id).history.length === 2);
  ok('the old submission can no longer be reviewed', (await call(T + '/submissions/' + subId + '/review', { method: 'POST', cookie: ped.cookie, body: { decision: 'approve' } })).status === 409);
  const sub2 = (await call(T + '/admin/overview', { cookie: ped.cookie })).body.queue[0].id;
  await call(T + '/submissions/' + sub2 + '/review', { method: 'POST', cookie: ped.cookie, body: { decision: 'approve', feedback: 'מצוין' } });
  r = await call(T + '/me', { cookie: dana.cookie });
  ok('approved: module A completes and B unlocks', r.body.assignments[0].modules[0].state.status === 'completed' && r.body.assignments[0].modules[1].locked === false);

  r = await call(T + '/me/modules/' + modB.id + '?assignment=' + asg, { cookie: dana.cookie });
  const refl = r.body.module.blocks[0].block;
  r = await call(T + '/me/submit', { method: 'POST', cookie: dana.cookie, body: { assignmentId: asg, moduleId: modB.id, blockId: refl.id, body: { text: 'רפלקציה' } } });
  ok('a reflection without review completes on submission', r.body.module.state.status === 'completed');
  r = await call(T + '/me', { cookie: dana.cookie });
  ok('the optional module does not block completion', r.body.assignments[0].allRequiredDone === true && r.body.assignments[0].percent === 100);

  console.log('\nTraining · content changes mid-training');
  r = await call(T + '/modules/' + modB.id, { cookie: ped.cookie });
  const bBlocks = r.body.module.blocks.concat([{ type: 'checklist', title: 'חדש', items: [{ text: 'סעיף חדש' }] }]);
  await call(T + '/modules/' + modB.id, { method: 'PATCH', cookie: ped.cookie, body: { rev: r.body.module.rev, blocks: bBlocks } });
  r = await call(T + '/me', { cookie: dana.cookie });
  ok('an unpublished draft does not reach the teacher', r.body.assignments[0].modules[1].state.status === 'completed');
  await call(T + '/modules/' + modB.id + '/publish', { method: 'POST', cookie: ped.cookie, body: {} });
  r = await call(T + '/me', { cookie: dana.cookie });
  ok('publishing a new required item reopens the module, progress kept', r.body.assignments[0].modules[1].state.status === 'in_progress' && r.body.assignments[0].modules[1].state.activitiesDone === 1);
  ok('and she is told it changed', r.body.notifications.some(n => n.kind === 'module'));
  /* Put it back so the readiness step below runs on a finished path. */
  const vs = (await call(T + '/modules/' + modB.id + '/versions', { cookie: ped.cookie })).body.versions;
  const firstPublish = vs.filter(v => v.kind === 'publish').sort((x, y) => x.rev - y.rev)[0];
  r = await call(T + '/modules/' + modB.id + '/restore', { method: 'POST', cookie: ped.cookie, body: { versionId: firstPublish.id } });
  ok('an earlier version can be restored as the draft', r.body.ok && r.body.module.blocks.length === 1);
  await call(T + '/modules/' + modB.id + '/publish', { method: 'POST', cookie: ped.cookie, body: {} });

  console.log('\nTraining · readiness and follow-up');
  ok('readiness needs a decision', (await call(T + '/assignments/' + asg + '/readiness', { method: 'POST', cookie: ped.cookie, body: {} })).status === 400);
  ok('"more training" needs a note', (await call(T + '/assignments/' + asg + '/readiness', { method: 'POST', cookie: ped.cookie, body: { decision: 'more_training' } })).status === 400);
  r = await call(T + '/assignments/' + asg + '/readiness', { method: 'POST', cookie: ped.cookie, body: { decision: 'ready', note: 'מוכנה', teachingStart: '2026-10-20' } });
  ok('the manager records "ready to teach"', r.body.ok === true);
  r = await call(T + '/me', { cookie: dana.cookie });
  const a0 = r.body.assignments[0];
  ok('readiness is recorded with who decided', a0.readiness === 'ready' && a0.readinessBy === 'מושיק גואטה' && a0.status === 'completed');
  ok('four follow-up checkpoints open from the teaching start', a0.followups.length === 4 && a0.followups[0].dueDate === '2026-10-20' && a0.followups[3].dueDate === '2026-11-19');
  r = await call(T + '/me/followups/' + a0.followups[0].id, { method: 'PATCH', cookie: dana.cookie, body: { reflection: 'השיעור הראשון עבר טוב' } });
  ok('the teacher writes her reflection', r.body.followup.reflection === 'השיעור הראשון עבר טוב');
  ok('another teacher cannot write it', (await call(T + '/me/followups/' + a0.followups[0].id, { method: 'PATCH', cookie: vet.cookie, body: { reflection: 'x' } })).status === 404);
  r = await call(T + '/followups/' + a0.followups[0].id, { method: 'PATCH', cookie: ped.cookie, body: { managerNotes: 'שיחה טובה', recommendations: 'לגוון פעילויות', status: 'done' } });
  ok('the manager closes the checkpoint with notes', r.body.followup.status === 'done' && r.body.followup.recommendations === 'לגוון פעילויות');
  r = await call(T + '/me', { cookie: dana.cookie });
  ok('the teacher sees the recommendations but not the private notes',
    r.body.assignments[0].followups[0].recommendations === 'לגוון פעילויות' && !JSON.stringify(r.body).includes('שיחה טובה'));

  console.log('\nTraining · continuing training after onboarding');
  r = await call(T + '/paths', { method: 'POST', cookie: ped.cookie, body: { title: 'רענון כלי Quizlet', kind: 'continuing', modules: [{ moduleId: modC.id }] } });
  const cont = r.body.path;
  r = await call(T + '/assignments', { method: 'POST', cookie: ped.cookie, body: { userId: dana.id, pathId: cont.id } });
  ok('a follow-on training is assigned after onboarding', r.status === 201);
  r = await call(T + '/assignments', { method: 'POST', cookie: ped.cookie, body: { userId: vet.id, pathId: cont.id } });
  ok('and to a veteran teacher', r.status === 201);
  r = await call(T + '/me', { cookie: vet.cookie });
  ok('the veteran sees only the continuing path', r.body.assignments.length === 1 && r.body.assignments[0].pathKind === 'continuing');
  r = await call(T + '/me', { cookie: dana.cookie });
  ok('the new teacher keeps her history and gets the new path', r.body.assignments.length === 2);

  console.log('\nTraining · hub, search, audit');
  r = await call(T + '/resources', { cookie: ped.cookie });
  const res0 = r.body.resources.find(x => x.title === 'Quizlet Guide');
  r = await call(T + '/resources/' + res0.id, { method: 'PATCH', cookie: ped.cookie, body: { status: 'official' } });
  ok('a resource is made official', r.body.resource.status === 'official');
  ok('a bad URL is refused', (await call(T + '/resources/' + res0.id, { method: 'PATCH', cookie: ped.cookie, body: { url: 'javascript:alert(1)' } })).status === 400);
  r = await call(T + '/resources', { cookie: dana.cookie });
  ok('teachers see official resources only', r.body.resources.length === 1);
  r = await call(T + '/resources/' + res0.id + '/favorite', { method: 'POST', cookie: dana.cookie, body: {} });
  ok('a teacher stars a resource', r.body.favorite === true && (await call(T + '/resources', { cookie: dana.cookie })).body.resources[0].favorite === true);
  const draftRes = (await call(T + '/resources', { cookie: ped.cookie })).body.resources.find(x => x.status === 'draft');
  ok('a draft cannot be starred by a teacher', (await call(T + '/resources/' + draftRes.id + '/favorite', { method: 'POST', cookie: dana.cookie, body: {} })).status === 404);
  r = await call(T + '/search?q=quizlet', { cookie: dana.cookie });
  ok('search finds the official resource', r.body.results.some(x => x.type === 'resource' && x.title === 'Quizlet Guide'));
  r = await call(T + '/search?q=' + encodeURIComponent('2+2'), { cookie: dana.cookie });
  ok('search finds text inside her modules', r.body.results.some(x => x.type === 'module' && x.id === modA.id));
  r = await call(T + '/search?q=' + encodeURIComponent('Cycle Method'), { cookie: dana.cookie });
  ok('search does not reach modules outside her paths', !r.body.results.some(x => x.type === 'module'));
  r = await call(T + '/audit', { cookie: ped.cookie });
  const acts = r.body.audit.map(x => x.action);
  ok('management actions are in the audit log', ['assignment.create', 'submission.needs_revision', 'submission.approved', 'readiness.ready', 'module.publish', 'template.seed'].every(a => acts.includes(a)));
  ok('teachers cannot read the audit log', (await call(T + '/audit', { cookie: dana.cookie })).status === 403);

  console.log('\nTraining · announcements and archive');
  r = await call(T + '/announcements', { method: 'POST', cookie: ped.cookie, body: { title: 'עדכון מתודולוגי', body: 'פרטים', kind: 'update' } });
  ok('an announcement is published', r.status === 201);
  r = await call(T + '/me', { cookie: vet.cookie });
  ok('teachers see it in What\'s New', r.body.announcements.some(a => a.title === 'עדכון מתודולוגי'));
  await call(T + '/notifications/read', { method: 'POST', cookie: vet.cookie, body: {} });
  ok('notifications can be marked read', (await call(T + '/notifications', { cookie: vet.cookie })).body.unread === 0);
  r = await call(T + '/modules/' + modC.id + '/archive', { method: 'POST', cookie: ped.cookie, body: {} });
  ok('a module goes to the archive', r.body.module.status === 'archived');
  ok('an archived module cannot be edited', (await call(T + '/modules/' + modC.id, { method: 'PATCH', cookie: ped.cookie, body: { title: 'x' } })).status === 409);
  r = await call(T + '/me', { cookie: vet.cookie });
  ok('an archived module drops out of the teacher\'s path', r.body.assignments[0].modules[0].available === false);
  r = await call(T + '/modules/' + modA.id + '/duplicate', { method: 'POST', cookie: ped.cookie, body: {} });
  ok('duplicating gives fresh block ids', r.status === 201 && r.body.module.blocks.every((b, i) => b.id !== modA.blocks[i].id));
  r = await call(T + '/assignments/' + asg + '/reset', { method: 'POST', cookie: ped.cookie, body: { moduleId: modA.id } });
  ok('the manager can reset a module\'s answers', r.body.ok === true);
  r = await call(T + '/me/modules/' + modA.id + '?assignment=' + asg, { cookie: dana.cookie });
  ok('after a reset the item is open again, the approval kept', !r.body.module.blocks.find(x => x.block.type === 'mcq').progress && r.body.module.blocks.find(x => x.block.type === 'open').submission.status === 'approved');

  console.log('\nTraining · accounts stay manageable');
  ok('deleting a teacher with training history still works', (await call('/api/staff/users/' + vet.id, { method: 'DELETE', cookie: admin })).body.ok === true);
  r = await call(T + '/admin/overview', { cookie: ped.cookie });
  ok('her history remains, marked as a deleted account', r.body.rows.some(x => x.userId === vet.id && x.name === '(חשבון נמחק)'));
}
