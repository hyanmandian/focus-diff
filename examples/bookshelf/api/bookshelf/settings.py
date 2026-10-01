import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///bookshelf.db")
session_factory = sessionmaker(create_engine(DATABASE_URL))
