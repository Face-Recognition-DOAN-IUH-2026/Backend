import 'reflect-metadata';
import { AppDataSource } from './data-source';
import { Book } from './entities/Book';
import { BookCopy } from './entities/BookCopy';

const BOOKS_DATA = [
  { isbn: '9780132350884', title: 'Clean Code', subtitle: 'A Handbook of Agile Software Craftsmanship', author: 'Robert C. Martin', publisher: 'Prentice Hall', publishedDate: '2008', pageCount: 464, categories: 'Programming', language: 'en', isbn10: '0132350882', isbn13: '9780132350884', shelfLocation: 'A-01-01' },
  { isbn: '9780201633610', title: 'Design Patterns', subtitle: 'Elements of Reusable Object-Oriented Software', author: 'Erich Gamma, Richard Helm, Ralph Johnson, John Vlissides', publisher: 'Addison-Wesley', publishedDate: '1994', pageCount: 395, categories: 'Programming', language: 'en', isbn10: '0201633612', isbn13: '9780201633610', shelfLocation: 'A-01-02' },
  { isbn: '9780262033848', title: 'Introduction to Algorithms', subtitle: 'Third Edition', author: 'Thomas H. Cormen, Charles E. Leiserson, Ronald L. Rivest, Clifford Stein', publisher: 'MIT Press', publishedDate: '2009', pageCount: 1312, categories: 'Computer Science', language: 'en', isbn10: '0262033844', isbn13: '9780262033848', shelfLocation: 'A-02-01' },
  { isbn: '9780073523323', title: 'The C Programming Language', subtitle: '', author: 'Brian W. Kernighan, Dennis M. Ritchie', publisher: 'Prentice Hall', publishedDate: '1988', pageCount: 272, categories: 'Programming', language: 'en', isbn10: '007352332X', isbn13: '9780073523323', shelfLocation: 'A-01-03' },
  { isbn: '9780135957059', title: 'The Pragmatic Programmer', subtitle: 'Your Journey To Mastery', author: 'David Thomas, Andrew Hunt', publisher: 'Addison-Wesley', publishedDate: '2019', pageCount: 352, categories: 'Programming', language: 'en', isbn10: '0135957052', isbn13: '9780135957059', shelfLocation: 'A-01-04' },
  { isbn: '9780596517747', title: 'JavaScript: The Good Parts', subtitle: '', author: 'Douglas Crockford', publisher: "O'Reilly Media", publishedDate: '2008', pageCount: 176, categories: 'Programming', language: 'en', isbn10: '0596517742', isbn13: '9780596517747', shelfLocation: 'B-01-01' },
  { isbn: '9780596007126', title: 'Head First Design Patterns', subtitle: '', author: 'Eric Freeman, Elisabeth Robson', publisher: "O'Reilly Media", publishedDate: '2004', pageCount: 676, categories: 'Programming', language: 'en', isbn10: '0596007124', isbn13: '9780596007126', shelfLocation: 'A-01-05' },
  { isbn: '9780134685991', title: 'Effective Java', subtitle: '', author: 'Joshua Bloch', publisher: 'Addison-Wesley', publishedDate: '2018', pageCount: 416, categories: 'Programming', language: 'en', isbn10: '013468599X', isbn13: '9780134685991', shelfLocation: 'A-02-02' },
  { isbn: '9780321125217', title: 'Domain-Driven Design', subtitle: 'Tackling Complexity in the Heart of Software', author: 'Eric Evans', publisher: 'Addison-Wesley', publishedDate: '2003', pageCount: 560, categories: 'Software Engineering', language: 'en', isbn10: '0321125215', isbn13: '9780321125217', shelfLocation: 'A-02-03' },
  { isbn: '9780134757599', title: 'Refactoring', subtitle: 'Improving the Design of Existing Code', author: 'Martin Fowler', publisher: 'Addison-Wesley', publishedDate: '2018', pageCount: 448, categories: 'Programming', language: 'en', isbn10: '0134757599', isbn13: '9780134757599', shelfLocation: 'A-01-06' },
  { isbn: '9781491946008', title: 'Fluent Python', subtitle: 'Clear, Concise, and Effective Programming', author: 'Luciano Ramalho', publisher: "O'Reilly Media", publishedDate: '2022', pageCount: 788, categories: 'Programming', language: 'en', isbn10: '1491946008', isbn13: '9781491946008', shelfLocation: 'B-01-02' },
  { isbn: '9781449357764', title: 'Python Cookbook', subtitle: 'Recipes for Mastering Python 3', author: 'David Beazley, Brian K. Jones', publisher: "O'Reilly Media", publishedDate: '2013', pageCount: 706, categories: 'Programming', language: 'en', isbn10: '1449357760', isbn13: '9781449357764', shelfLocation: 'B-01-03' },
  { isbn: '9780201835953', title: 'The Mythical Man-Month', subtitle: 'Essays on Software Engineering', author: 'Frederick P. Brooks Jr.', publisher: 'Addison-Wesley', publishedDate: '1995', pageCount: 336, categories: 'Software Engineering', language: 'en', isbn10: '0201835959', isbn13: '9780201835953', shelfLocation: 'A-03-01' },
  { isbn: '9781118031964', title: 'The Art of Software Testing', subtitle: '', author: 'Glenford J. Myers', publisher: 'Wiley', publishedDate: '2011', pageCount: 256, categories: 'Software Testing', language: 'en', isbn10: '1118031962', isbn13: '9781118031964', shelfLocation: 'A-03-02' },
  { isbn: '9780596006976', title: 'Head First Java', subtitle: 'A Brain-Friendly Guide', author: 'Kathy Sierra, Bert Bates', publisher: "O'Reilly Media", publishedDate: '2005', pageCount: 688, categories: 'Programming', language: 'en', isbn10: '0596006970', isbn13: '9780596006976', shelfLocation: 'A-02-04' },
  { isbn: '9780137680528', title: 'Core Java', subtitle: 'Volume I - Fundamentals', author: 'Cay S. Horstmann', publisher: 'Prentice Hall', publishedDate: '2022', pageCount: 928, categories: 'Programming', language: 'en', isbn10: '0137680528', isbn13: '9780137680528', shelfLocation: 'A-02-05' },
  { isbn: '9781617294136', title: 'Spring in Action', subtitle: '', author: 'Craig Walls', publisher: 'Manning', publishedDate: '2022', pageCount: 520, categories: 'Programming', language: 'en', isbn10: '1617294136', isbn13: '9781617294136', shelfLocation: 'B-02-01' },
  { isbn: '9781491954621', title: 'Learning React', subtitle: 'Modern Patterns for Developing React Apps', author: 'Alex Banks, Eve Porcello', publisher: "O'Reilly Media", publishedDate: '2017', pageCount: 250, categories: 'Web Development', language: 'en', isbn10: '1491954620', isbn13: '9781491954621', shelfLocation: 'B-02-02' },
  { isbn: '9781788835534', title: 'Full-Stack React Projects', subtitle: 'Learn React with Node, GraphQL, MongoDB, and Express', author: 'Shama Hoque', publisher: "Packt Publishing", publishedDate: '2018', pageCount: 470, categories: 'Web Development', language: 'en', isbn10: '1788835539', isbn13: '9781788835534', shelfLocation: 'B-02-03' },
  { isbn: '9781593279523', title: 'The Linux Command Line', subtitle: '', author: 'William Shotts', publisher: 'No Starch Press', publishedDate: '2019', pageCount: 480, categories: 'Linux', language: 'en', isbn10: '1593279523', isbn13: '9781593279523', shelfLocation: 'C-01-01' },
  { isbn: '9781593276027', title: 'Linux Pocket Guide', subtitle: '', author: 'Daniel J. Barrett', publisher: 'No Starch Press', publishedDate: '2016', pageCount: 232, categories: 'Linux', language: 'en', isbn10: '1593276022', isbn13: '9781593276027', shelfLocation: 'C-01-02' },
  { isbn: '9780596004231', title: 'Head First HTML and CSS', subtitle: '', author: 'Elisabeth Robson, Eric Freeman', publisher: "O'Reilly Media", publishedDate: '2005', pageCount: 688, categories: 'Web Development', language: 'en', isbn10: '0596004230', isbn13: '9780596004231', shelfLocation: 'B-01-04' },
  { isbn: '9780596521981', title: 'Learning SQL', subtitle: 'Master SQL Fundamentals', author: 'Alan Beaulieu', publisher: "O'Reilly Media", publishedDate: '2009', pageCount: 332, categories: 'Database', language: 'en', isbn10: '0596521987', isbn13: '9780596521981', shelfLocation: 'C-01-03' },
  { isbn: '9781617291609', title: 'MongoDB in Action', subtitle: '', author: 'Kyle Banker', publisher: 'Manning', publishedDate: '2016', pageCount: 320, categories: 'Database', language: 'en', isbn10: '1617291609', isbn13: '9781617291609', shelfLocation: 'C-01-04' },
  { isbn: '9780133970777', title: 'Computer Networks', subtitle: 'A Systems Approach', author: 'Larry L. Peterson, Bruce S. Davie', publisher: 'Morgan Kaufmann', publishedDate: '2021', pageCount: 864, categories: 'Computer Science', language: 'en', isbn10: '0133970779', isbn13: '9780133970777', shelfLocation: 'A-03-03' },
  { isbn: '9780134610993', title: 'Artificial Intelligence', subtitle: 'A Modern Approach', author: 'Stuart Russell, Peter Norvig', publisher: 'Pearson', publishedDate: '2020', pageCount: 1138, categories: 'AI', language: 'en', isbn10: '0134610997', isbn13: '9780134610993', shelfLocation: 'A-04-01' },
  { isbn: '9781119800361', title: 'Operating System Concepts', subtitle: '', author: 'Abraham Silberschatz, Greg Gagne, Peter B. Galvin', publisher: 'Wiley', publishedDate: '2018', pageCount: 832, categories: 'Operating Systems', language: 'en', isbn10: '1119800360', isbn13: '9781119800361', shelfLocation: 'A-04-02' },
  { isbn: '9780130460196', title: 'Network Security', subtitle: 'Private Communication in a Public World', author: 'Charlie Kaufman, Radia Perlman, Mike Speciner', publisher: 'Prentice Hall', publishedDate: '2002', pageCount: 650, categories: 'Security', language: 'en', isbn10: '0130460192', isbn13: '9780130460196', shelfLocation: 'C-02-01' },
  { isbn: '9780132774208', title: 'Digital Design', subtitle: 'With an Introduction to the Verilog HDL', author: 'M. Morris Mano, Michael D. Ciletti', publisher: 'Pearson', publishedDate: '2013', pageCount: 592, categories: 'Digital Design', language: 'en', isbn10: '0132774208', isbn13: '9780132774208', shelfLocation: 'C-02-02' },
  { isbn: '9781593271442', title: 'The Art of Exploitation', subtitle: '', author: 'Jon Erickson', publisher: 'No Starch Press', publishedDate: '2008', pageCount: 520, categories: 'Security', language: 'en', isbn10: '1593271441', isbn13: '9781593271442', shelfLocation: 'C-02-03' },
];

async function seed() {
  try {
    await AppDataSource.initialize();
    console.log('[seed] borrow-service Database connected');

    const bookRepo = AppDataSource.getRepository(Book);
    const copyRepo = AppDataSource.getRepository(BookCopy);

    let booksCreated = 0;
    let booksSkipped = 0;
    let copiesCreated = 0;
    let copiesSkipped = 0;

    // Seed books
    for (const data of BOOKS_DATA) {
      const existing = await bookRepo.findOne({ where: { isbn: data.isbn } });
      if (existing) {
        console.log(`[seed] Book already exists: ${data.title}`);
        booksSkipped++;
        continue;
      }
      const book = bookRepo.create({
        isbn: data.isbn,
        title: data.title,
        subtitle: data.subtitle || null,
        author: data.author,
        coverUrl: `https://covers.openlibrary.org/b/isbn/${data.isbn}-L.jpg`,
        publisher: data.publisher,
        publishedDate: data.publishedDate,
        description: null,
        pageCount: data.pageCount,
        categories: data.categories,
        averageRating: Math.round((3.5 + Math.random() * 1.5) * 10) / 10,
        language: data.language,
        isbn10: data.isbn10,
        isbn13: data.isbn13,
        isAvailable: true,
        shelfLocation: data.shelfLocation,
      });
      await bookRepo.save(book);
      console.log(`[seed] Created book: ${data.title}`);
      booksCreated++;

      // Create 2-3 copies per book
      const copiesCount = 2 + Math.floor(Math.random() * 2); // 2 or 3
      for (let i = 1; i <= copiesCount; i++) {
        const barcode = `BC-${data.isbn.slice(-4)}-${String(i).padStart(2, '0')}`;
        const existingCopy = await copyRepo.findOne({ where: { barcode } });
        if (existingCopy) {
          copiesSkipped++;
          continue;
        }
        const copy = copyRepo.create({
          bookId: book.id,
          barcode,
          isAvailable: true,
          shelfLocation: data.shelfLocation,
        });
        await copyRepo.save(copy);
        copiesCreated++;
      }
    }

    console.log(`[seed] Done. Books: ${booksCreated} created, ${booksSkipped} skipped. Copies: ${copiesCreated} created, ${copiesSkipped} skipped.`);
    await AppDataSource.destroy();
    process.exit(0);
  } catch (error) {
    console.error('[seed] Failed:', error);
    process.exit(1);
  }
}

seed();
