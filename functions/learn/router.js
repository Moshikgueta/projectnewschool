/* Routes for /api/learn/* (students) and /api/manage/* (staff).

   One guard runs before any handler: a state-changing request must be JSON
   (or multipart for an upload) and, when the browser says where it came
   from, from this origin. A cross-site form cannot send application/json
   without a CORS preflight this Worker never answers, and the SameSite=Lax
   session cookie is not sent on cross-site subrequests — together that is
   the CSRF protection. */

import * as S from './student.js';
import * as M from './manage.js';
import { fail } from './_core.js';

const R = [
  ['GET', /^\/api\/learn\/config$/, S.getConfig],
  ['GET', /^\/api\/learn\/me$/, S.getMe],
  ['PATCH', /^\/api\/learn\/prefs$/, S.patchPrefs],
  ['GET', /^\/api\/learn\/levels\/([\w-]+)\/topics$/, S.getLevelTopics],
  ['GET', /^\/api\/learn\/levels\/([\w-]+)\/dashboard$/, S.getDashboard],
  ['GET', /^\/api\/learn\/levels\/([\w-]+)\/review$/, S.getReview],
  ['GET', /^\/api\/learn\/levels\/([\w-]+)\/review\/session$/, S.getReviewSession],
  ['GET', /^\/api\/learn\/levels\/([\w-]+)\/saved$/, S.getSaved],
  ['GET', /^\/api\/learn\/levels\/([\w-]+)\/glossary$/, S.getGlossary],
  ['GET', /^\/api\/learn\/levels\/([\w-]+)\/progress$/, S.getProgress],
  ['GET', /^\/api\/learn\/levels\/([\w-]+)\/game$/, S.getGame],
  ['POST', /^\/api\/learn\/levels\/([\w-]+)\/game$/, S.postGameResult],
  ['GET', /^\/api\/learn\/topics\/([\w-]+)$/, S.getTopic],
  ['PUT', /^\/api\/learn\/exercises\/([\w-]+)\/state$/, S.putState],
  ['POST', /^\/api\/learn\/exercises\/([\w-]+)\/check$/, S.postCheck],
  ['POST', /^\/api\/learn\/exercises\/([\w-]+)\/self$/, S.postSelf],
  ['POST', /^\/api\/learn\/exercises\/([\w-]+)\/flag$/, S.postFlag],
  ['POST', /^\/api\/learn\/items\/check$/, S.postItemCheck],
  ['POST', /^\/api\/learn\/saved$/, S.postSaved],
  ['GET', /^\/api\/learn\/media\/([\w-]+)$/, S.getMedia],

  ['GET', /^\/api\/manage\/me$/, M.getManageMe],
  ['GET', /^\/api\/manage\/courses$/, M.getCourses],
  ['PATCH', /^\/api\/manage\/languages\/([\w-]+)$/, M.patchLanguage],
  ['POST', /^\/api\/manage\/levels$/, M.postLevel],
  ['GET', /^\/api\/manage\/levels\/([\w-]+)$/, M.getLevel],
  ['PATCH', /^\/api\/manage\/levels\/([\w-]+)$/, M.patchLevel],
  ['DELETE', /^\/api\/manage\/levels\/([\w-]+)$/, M.deleteLevel],
  ['POST', /^\/api\/manage\/levels\/([\w-]+)\/cycles$/, M.postCycle],
  ['PATCH', /^\/api\/manage\/cycles\/([\w-]+)$/, M.patchCycle],
  ['DELETE', /^\/api\/manage\/cycles\/([\w-]+)$/, M.deleteCycle],
  ['POST', /^\/api\/manage\/levels\/([\w-]+)\/topics$/, M.postTopic],
  ['GET', /^\/api\/manage\/topics\/([\w-]+)$/, M.getManageTopic],
  ['PATCH', /^\/api\/manage\/topics\/([\w-]+)$/, M.patchTopic],
  ['DELETE', /^\/api\/manage\/topics\/([\w-]+)$/, M.deleteTopic],
  ['POST', /^\/api\/manage\/topics\/([\w-]+)\/exercises$/, M.postExercise],
  ['POST', /^\/api\/manage\/topics\/([\w-]+)\/media$/, M.postMedia],
  ['PATCH', /^\/api\/manage\/exercises\/([\w-]+)$/, M.patchExercise],
  ['DELETE', /^\/api\/manage\/exercises\/([\w-]+)$/, M.deleteExercise],
  ['GET', /^\/api\/manage\/preview\/topics\/([\w-]+)$/, M.getPreviewTopic],
  ['POST', /^\/api\/manage\/preview\/exercises\/([\w-]+)\/check$/, M.postPreviewCheck],
  ['GET', /^\/api\/manage\/students$/, M.getStudents],
  ['POST', /^\/api\/manage\/students$/, M.postStudent],
  ['POST', /^\/api\/manage\/students\/([\w-]+)\/code$/, M.postStudentCode],
  ['GET', /^\/api\/manage\/students\/([\w-]+)\/progress$/, M.getStudentProgress],
  ['POST', /^\/api\/manage\/enrollments$/, M.postEnrollment],
  ['POST', /^\/api\/manage\/enrollments\/([\w-]+)\/end$/, M.postEndEnrollment],
  ['GET', /^\/api\/manage\/levels\/([\w-]+)\/report$/, M.getLevelReport],
  ['GET', /^\/api\/manage\/levels\/([\w-]+)\/assignments$/, M.getAssignments],
  ['POST', /^\/api\/manage\/levels\/([\w-]+)\/assignments$/, M.postAssignment],
  ['POST', /^\/api\/manage\/assignments\/([\w-]+)\/archive$/, M.postArchiveAssignment],
  ['GET', /^\/api\/manage\/levels\/([\w-]+)\/flags$/, M.getFlags],
  ['POST', /^\/api\/manage\/flags\/([\w-]+)$/, M.postFlagDecision],
  ['GET', /^\/api\/manage\/teachers$/, M.getTeachers],
  ['PUT', /^\/api\/manage\/teachers\/([\w-]+)\/levels$/, M.putTeacherLevels]
];

function sameOriginWrite(request) {
  if (request.method === 'GET' || request.method === 'HEAD') return true;
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return false;
  const ct = (request.headers.get('Content-Type') || '').toLowerCase();
  return ct.startsWith('application/json') || ct.startsWith('multipart/form-data');
}

export async function learnRoute(request, env, path) {
  if (!path.startsWith('/api/learn/') && !path.startsWith('/api/manage/')) return null;
  let methodMatched = false;
  for (const [method, re, fn] of R) {
    const m = re.exec(path);
    if (!m) continue;
    methodMatched = true;
    if (method !== request.method) continue;
    if (!sameOriginWrite(request)) return fail(403, 'בקשה נחסמה.', { code: 'csrf' });
    try {
      return await fn({ request, env, params: { id: m[1] } });
    } catch (err) {
      console.error('learn route error', path, err && err.stack || err);
      return fail(500, 'משהו השתבש בשרת. הנתונים שלכם לא אבדו — נסו שוב בעוד רגע.', { code: 'server' });
    }
  }
  return fail(methodMatched ? 405 : 404, 'not found');
}
