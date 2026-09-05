import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.declarative import declarative_base

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # run: pip install python-dotenv

URL_DATABASE = os.environ.get("DATABASE_URL")

if not URL_DATABASE:
    raise RuntimeError(
        "DATABASE_URL not set. Create Backend/.env with your database connection string."
    )

engine = create_engine(URL_DATABASE, echo=False)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
