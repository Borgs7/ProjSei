from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.declarative import declarative_base

URL_DATABASE = 'postgresql://postgres:M1L3t_yes!@localhost:5432/SeiScanDB'

engine = create_engine(URL_DATABASE, echo=False)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Using the non-deprecated import
Base = declarative_base()


# Dependency for FastAPI routes
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()