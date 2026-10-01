from fastapi import FastAPI

from .books.routes import router as books_router
from .authors.routes import router as authors_router
from .shelves.routes import router as shelves_router
from .reviews.routes import router as reviews_router
from .search.routes import router as search_router
from .users.routes import router as users_router
from .imports.routes import router as imports_router
from .recommendations.routes import router as recommendations_router

app = FastAPI(title="Bookshelf")
app.include_router(books_router)
app.include_router(authors_router)
app.include_router(shelves_router)
app.include_router(reviews_router)
app.include_router(search_router)
app.include_router(users_router)
app.include_router(imports_router)
app.include_router(recommendations_router)
