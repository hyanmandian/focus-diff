from fastapi import FastAPI

app = FastAPI(title="Reading list")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
