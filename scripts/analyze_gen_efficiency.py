import os, json, glob
from collections import defaultdict

profiles = {
    1: [6, 8],
    2: [8, 10],
    3: [10, 12],
    4: [12, 14],
    5: [14, 100]
}

data = []
files = glob.glob('out_generated/*.json')

for f in files:
    try:
        with open(f, 'r', encoding='utf-8') as jf:
            d = json.load(jf)
            if 'experiment' not in d or 'metrics' not in d: continue
            
            exp = d.get('experiment', {})
            # Only consider Chapter 5 Pilot Baseline experiments
            if not exp.get('experiment_id', '').startswith('ch5_'): continue
            
            model = d.get('model', 'unknown')
            level = d.get('level', 0)
            target_w = d.get('target_words', 0)
            actual_w = d.get('metrics', {}).get('word_count', 0)
            fk = d.get('metrics', {}).get('flesch_kincaid_grade', 0)
            attempts = d.get('generation_meta', {}).get('attempts_used', 1)
            
            p_range = profiles.get(level, [0, 0])
            hit = p_range[0] <= fk <= p_range[1]
            
            data.append({
                'model': model,
                'level': level,
                'target_w': target_w,
                'actual_w': actual_w,
                'fk': fk,
                'hit': hit,
                'attempts': attempts
            })
    except Exception as e:
        continue

# Summary by Model
model_stats = defaultdict(lambda: {'count': 0, 'hits': 0, 'len_dev': 0, 'attempts': 0})
for item in data:
    key = item['model']
    model_stats[key]['count'] += 1
    if item['hit']: model_stats[key]['hits'] += 1
    model_stats[key]['len_dev'] += abs(item['actual_w'] - item['target_w']) / item['target_w']
    model_stats[key]['attempts'] += item['attempts']

print("### 1. Model Adherence Performance")
print("| Model | Samples | Len Dev % | Hit Rate % | Avg Attempts |")
print("| :--- | :--- | :--- | :--- | :--- |")
for m in sorted(model_stats.keys()):
    s = model_stats[m]
    cnt = s['count']
    ldev = (s['len_dev']/cnt)*100
    hrate = (s['hits']/cnt)*100
    att = s['attempts']/cnt
    print(f"| {m} | {cnt} | {ldev:.1f}% | {hrate:.1f}% | {att:.1f} |")

# Summary by Level (Global Drift)
print("\n### 2. Difficulty Level Drift (FK Grade)")
print("| Level | Mean FK | Target | Drift | Status |")
print("| :--- | :--- | :--- | :--- | :--- |")
lvl_stats = defaultdict(lambda: {'fk_sum': 0, 'count': 0})
for item in data:
    lvl_stats[item['level']]['fk_sum'] += item['fk']
    lvl_stats[item['level']]['count'] += 1

for lvl in sorted(lvl_stats.keys()):
    s = lvl_stats[lvl]
    mean_fk = s['fk_sum'] / s['count']
    target = profiles[lvl]
    t_center = (target[0] + target[1]) / 2 if target[1] < 100 else 14
    drift = mean_fk - t_center
    status = "Over-complex" if drift > 0 else "Under-complex"
    if abs(drift) < 1.0: status = "Near Target"
    print(f"| L{lvl} | {mean_fk:.2f} | {target[0]}-{target[1] if target[1]<100 else '+'} | {drift:+.2f} | {status} |")
