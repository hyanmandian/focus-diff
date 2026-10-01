import { useState } from 'react';
import { BookCard } from '../components/BookCard/BookCard';
import { useBooks } from '../hooks/useBooks';
import { pluralize } from '../utils/format';

export function ReadingList() {
  const [search, setSearch] = useState('');
  const { data: books = [], isLoading } = useBooks(search);

  return (
    <main>
      <h1>Reading list</h1>
      <label>
        Search
        <input value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      {isLoading ? <p>Loading…</p> : <p>{pluralize(books.length, 'book')}</p>}
      <div className="grid">
        {books.map((book) => <BookCard key={book.id} book={book} />)}
      </div>
    </main>
  );
}
