import json
import random

print('Loading original file...')
with open('data/pga_points.geojson', 'r', encoding='utf-8') as f:
    data = json.load(f)

original_count = len(data['features'])
print(f'Original: {original_count} points')

# Sample 5000 points (still very accurate for interpolation!)
sample_size = 5000
sampled_features = random.sample(data['features'], sample_size)

# Create new GeoJSON
sampled_data = {
    'type': 'FeatureCollection',
    'features': sampled_features
}

# Save
print('Saving sampled file...')
with open('data/pga_points_sampled.geojson', 'w', encoding='utf-8') as f:
    json.dump(sampled_data, f)

print(f'✓ Done! Sampled {sample_size} points from {original_count}')
print(f'✓ File saved: data/pga_points_sampled.geojson')