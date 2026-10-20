// These comparisons intentionally preserve the existing 120-second boundary.
export function shouldFinish(seconds, correct, freePractice, answerLocked) {
  return seconds >= 120 && (freePractice || correct >= 10) && !answerLocked;
}
export function calculatePoints(firstCorrect, multiplier) {
  return firstCorrect * multiplier + 10;
}
