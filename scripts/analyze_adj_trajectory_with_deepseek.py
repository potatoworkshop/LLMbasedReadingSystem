import os, json, csv, glob
from collections import defaultdict

profiles = {
    1: [6, 8],
    2: [8, 10],
    3: [10, 12],
    4: [12, 14],
    5: [14, 100]
}

def get_target_center(lvl):
    t = profiles[lvl]
    return (t[0] + t[1]) / 2 if t[1] < 100 else 15

csv_path = 'experiments/ch5/analysis/main_n8_2026-03-01T12-48-35_task_level_with_recovery.csv'

# Store all records: model -> list of data
model_data = defaultdict(list)

# 1. Read CSV for Grok and GPT-5 only
with open(csv_path, 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        m = row['model']
        if 'grok' in m.lower():
            label = 'x-ai/grok-4.1-fast'
        elif 'gpt-5' in m.lower():
            label = 'openai/gpt-5-mini'
        else:
            # Skip Gemini (to be replaced by DeepSeek)
            continue
            
        try:
            rounds = int(row.get('rounds_used')) if row.get('rounds_used') else 0
        except ValueError:
            rounds = 0
        try:
            fidelity = float(row.get('fidelity_overall')) if row.get('fidelity_overall') else 0.0
        except ValueError:
            fidelity = 0.0
            
        model_data[label].append({
            'level': int(row['target_level']),
            'hit': row.get('hit_target') == 'True',
            'rounds': rounds,
            'fidelity': fidelity,
            'article_id': row.get('article_id')
        })

# 2. Read DeepSeek Manifests
ds_files = glob.glob('experiments/ch5/manifests/adjusted_replace_gemini_fast80_deepseek_v32_mb*.json')
for f in ds_files:
    with open(f, 'r', encoding='utf-8') as jf:
        batch = json.load(jf)
        for rec in batch.get('records', []):
            if not rec.get('ok'): continue
            model_data['deepseek/deepseek-v3.2'].append({
                'level': rec['target_level'],
                'hit': rec.get('hit_target') == True,
                'rounds': rec.get('rounds_used', 0),
                'fidelity': rec.get('fidelity_overall', 0),
                'article_id': rec.get('article_id')
            })

# Final Stats
final_stats = defaultdict(lambda: {'hits': 0, 'total': 0, 'rounds': 0, 'fidelity': 0})
drift_matrix = defaultdict(lambda: defaultdict(list))

for model, entries in model_data.items():
    for res in entries:
        final_stats[model]['total'] += 1
        if res['hit']: final_stats[model]['hits'] += 1
        final_stats[model]['rounds'] += res['rounds']
        final_stats[model]['fidelity'] += res['fidelity']
        
        a_id = res['article_id']
        if a_id:
            a_path = f'out_simplified/{a_id}.json'
            if os.path.exists(a_path):
                with open(a_path, 'r', encoding='utf-8') as af:
                    ad = json.load(af)
                    final_metrics = ad.get('final_metrics', {})
                    final_fk = final_metrics.get('flesch_kincaid_grade', 0)
                    if final_fk == 0:
                        final_fk = ad.get('metrics', {}).get('flesch_kincaid_grade', 0)
                    if final_fk != 0:
                        drift = final_fk - get_target_center(res['level'])
                        drift_matrix[model][res['level']].append(drift)

print("### 1. Adjustment Success & Efficiency (DeepSeek Replacement)")
print("| Model | Samples | Hit Rate % | Avg Rounds | Avg Fidelity |")
print("| :--- | :--- | :--- | :--- | :--- |")
for m in sorted(final_stats.keys()):
    s = final_stats[m]
    if s['total'] == 0: continue
    print(f"| {m} | {s['total']} | {s['hits']/s['total']*100:.1f}% | {s['rounds']/s['total']:.2f} | {s['fidelity']/s['total']:.3f} |")

print("\n### 2. Post-Adjustment Residual Drift (FK Grade)")
print("| Model | L1 Drift | L2 Drift | L3 Drift | L4 Drift | L5 Drift |")
print("| :--- | :--- | :--- | :--- | :--- | :--- |")
for m in sorted(drift_matrix.keys()):
    row = [f"**{m}**"]
    for l in range(1, 6):
        drifts = drift_matrix[m].get(l, [])
        if drifts:
            avg_drift = sum(drifts) / len(drifts)
            row.append(f"{avg_drift:+.2f}")
        else:
            row.append("-")
    print("| " + " | ".join(row) + " |")
