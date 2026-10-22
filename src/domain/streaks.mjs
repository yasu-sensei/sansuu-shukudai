function bonusFor(streak) {
  return streak === 3 ? 20 : streak === 5 ? 30 : streak === 10 ? 50 : streak > 10 && streak % 10 === 0 ? 50 : 0;
}
function awardStreakBonuses(d, dates) {
  let streak = 0, earned = 0;
  for (const day of dates) {
    if (d.records[day]) {
      streak++;
      const reward = bonusFor(streak), key = `${day}:${streak}`;
      if (reward && !d.claimed[key]) {
        d.claimed[key] = reward;
        d.points += reward;
        earned += reward;
      }
    } else streak = 0;
  }
  return earned;
}
export {
  awardStreakBonuses,
  bonusFor
};
