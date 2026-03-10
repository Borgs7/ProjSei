import pandas as pd
import geopandas as gpd
from sqlalchemy import create_engine
from geoalchemy2 import WKTElement
import sys
sys.path.append('..')
from database import URL_DATABASE

def import_csv_to_database(csv_file: str, scenario_id: int):
    """Import PGA data from CSV to database"""
    
    # Read CSV
    df = pd.read_csv(csv_file)
    
    # Create GeoDataFrame
    gdf = gpd.GeoDataFrame(
        df,
        geometry=gpd.points_from_xy(df.longitude, df.latitude),
        crs="EPSG:4326"
    )
    
    # Prepare for database
    gdf['scenario_id'] = scenario_id
    gdf['geometry'] = gdf['geometry'].apply(lambda x: WKTElement(x.wkt, srid=4326))
    
    # Connect to database
    engine = create_engine(URL_DATABASE)
    
    # Insert to database
    gdf[['scenario_id', 'latitude', 'longitude', 'pga_value', 'geometry']].to_sql(
        'pga_points',
        engine,
        if_exists='append',
        index=False,
        method='multi',
        chunksize=1000
    )
    
    print(f"Imported {len(gdf)} points for scenario {scenario_id}")

if __name__ == "__main__":
    # Example usage
    import_csv_to_database('path/to/calapan_data.csv', scenario_id=1)