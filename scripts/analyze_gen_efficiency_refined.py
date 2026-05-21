import os, json, glob
from collections import defaultdict
from datetime import datetime

profiles = {
    1: [6, 8],
    2: [8, 10],
    3: [10, 12],
    4: [12, 14],
    5: [14, 100]
}

def get_target_center(lvl):
    target = profiles[lvl]
    return (target[0] + target[1]) / 2 if target[1] < 100 else 14

all_samples = []
files = glob.glob('out_generated/*.json')

for f in files:
    try:
        with open(f, 'r', encoding='utf-8') as jf:
            d = json.load(jf)
            if 'experiment' not in d or 'metrics' not in d: continue
            
            exp = d.get('experiment', {})
            # Filter for Chapter 5 Model Comparison experiment
            if exp.get('experiment_id') != 'ch5_e1_modelcmp_20260225': continue
            
            generated_at = d.get('generated_at', '1970-01-01T00:00:00.000Z')
            
            all_samples.append({
                'model': d.get('model', 'unknown'),
                'level': d.get('level', 0),
                'target_w': d.get('target_words', 0),
                'actual_w': d.get('metrics', {}).get('word_count', 0),
                'fk': d.get('metrics', {}).get('flesch_kincaid_grade', 0),
                'attempts': d.get('generation_meta', {}).get('attempts_used', 1),
                'timestamp': generated_at
            })
    except Exception:
        continue

# Sort by timestamp descending and take top 38 per model
model_groups = defaultdict(list)
for s in all_samples:
    model_groups[s['model']].append(s)

final_samples = []
TARGET_SIZE = 38

print(f"--- Data Selection Summary ---")
for model in sorted(model_groups.keys()):
    group = sorted(model_groups[model], key=lambda x: x['timestamp'], reverse=True)
    selected = group[:TARGET_SIZE]
    final_samples.extend(selected)
    print(f"Model: {model} | Total Found: {len(group)} | Selected: {len(selected)}")

# 1. Model Adherence Performance (Normalized)
model_stats = defaultdict(lambda: {'count': 0, 'hits': 0, 'len_dev': 0, 'attempts': 0})
for item in final_samples:
    m = item['model']
    model_stats[m]['count'] += 1
    p_range = profiles.get(item['level'], [0, 0])
    if p_range[0] <= item['fk'] <= p_range[1]:
        model_stats[m]['hits'] += 1
    model_stats[m]['len_dev'] += abs(item['actual_w'] - item['target_w']) / item['target_w']
    model_stats[m]['attempts'] += item['attempts']

print("\n### 1. Model Adherence Performance (n=38 per model)")
print("| Model | Len Dev % | Hit Rate % | Avg Attempts |")
print("| :--- | :--- | :--- | :--- |")
for m in sorted(model_stats.keys()):
    s = model_stats[m]
    cnt = s['count']
    print(f"| {m} | {(s['len_dev']/cnt)*100:.1f}% | {(s['hits']/cnt)*100:.1f}% | {s['attempts']/cnt:.1f} |")

# 2. Difficulty Level Drift (FK Grade) by Model
print("\n### 2. Difficulty Level Drift by Model (FK Grade)")
print("| Model | L1 (6-8) | L2 (8-10) | L3 (10-12) | L4 (12-14) | L5 (14+) |")
print("| :--- | :--- | :--- | :--- | :--- | :--- |")

# Nested dict: model -> level -> [fk_values]
drift_matrix = defaultdict(lambda: defaultdict(list))
for item in final_samples:
    drift_matrix[item['model']][item['level']].append(item['fk'])

for m in sorted(drift_matrix.keys()):
    row = [f"**{m}**"]
    for l in range(1, 6):
        vals = drift_matrix[m].get(l, [])
        if vals:
            avg = sum(vals) / len(vals)
            target = profiles[l]
            t_center = (target[0] + target[1]) / 2 if target[1] < 100 else 14
            drift = avg - t_center
            row.append(f"{avg:.1f} ({drift:+.1f})")
        else:
            row.append("-")
    print("| " + " | ".join(row) + " |")
