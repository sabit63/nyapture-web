import cover01 from '../assets/covers/cover-01.svg'
import cover02 from '../assets/covers/cover-02.svg'
import cover03 from '../assets/covers/cover-03.svg'
import cover04 from '../assets/covers/cover-04.svg'
import cover05 from '../assets/covers/cover-05.svg'
import cover06 from '../assets/covers/cover-06.svg'
import cover07 from '../assets/covers/cover-07.svg'
import cover08 from '../assets/covers/cover-08.svg'
import cover09 from '../assets/covers/cover-09.svg'
import cover10 from '../assets/covers/cover-10.svg'
import cover11 from '../assets/covers/cover-11.svg'
import cover12 from '../assets/covers/cover-12.svg'
import type { BookCardModel, BookTag, TagSet } from '../models'

const createTagSet = (tags: BookTag[]): TagSet => tags.reduce<TagSet>((tagSet, tag) => ({
  ...tagSet,
  [tag.type]: [...(tagSet[tag.type] ?? []), tag.name],
}), {})

const createPageUrls = (groupId: string, bookId: string, totalPage: number) => Array.from(
  { length: totalPage },
  (_, index) => `/api/book/page?bookId=${encodeURIComponent(bookId)}&groupId=${encodeURIComponent(groupId)}&page=${index + 1}`,
)

type BookSeed = Omit<BookCardModel, 'tagSet' | 'pageUrls'> & {
  pageUrls?: string[]
}

const createBook = (seed: BookSeed): BookCardModel => ({
  ...seed,
  tagSet: createTagSet(seed.tags),
  pageUrls: seed.pageUrls ?? createPageUrls(seed.groupId, seed.bookId, seed.totalPage),
})

export const books: BookCardModel[] = [
  createBook({
    groupId: 'local-library',
    bookId: 'local-001',
    url: 'https://local.nyapture.test/books/local-001',
    title: '雨音のアーカイブ',
    captions: { ja: '雨音のアーカイブ' },
    totalPage: 42,
    uploadedTime: '2026-08-28T09:30:00+09:00',
    status: 'Downloaded',
    source: 'Local',
    cover: 'violet',
    thumbnailUrl: cover01,
    tags: [
      { type: 'Artists', name: 'mizuki-ao', displayName: '水城アオ' },
      { type: 'Artists', name: 'shiro-kana', displayName: '白カナ' },
      { type: 'Groups', name: 'moonlit-press', displayName: '月灯舎' },
      { type: 'Parodies', name: 'rain-archive', displayName: '雨音アーカイブ' },
      { type: 'Categories', name: 'illustration', displayName: 'イラスト' },
      { type: 'Tags', name: 'short-stories', displayName: '短編集' },
      { type: 'Languages', name: 'japanese', displayName: '日本語' },
    ],
  }),
  createBook({
    groupId: 'hitomi-la',
    bookId: 'hitomi-002',
    url: 'https://hitomi.la/doujinshi/orbit-garden-002.html',
    title: '軌道上の庭園',
    captions: { ja: '軌道上の庭園', en: 'Garden in Orbit' },
    totalPage: 68,
    uploadedTime: '2026-08-27T14:00:00+09:00',
    status: 'WebBook',
    source: 'HitomiLa',
    cover: 'blue',
    thumbnailUrl: cover02,
    tags: [
      { type: 'Artists', name: 'n-hoshino', displayName: 'N. Hoshino' },
      { type: 'Artists', name: 'mizuki-ao', displayName: '水城アオ' },
      { type: 'Groups', name: 'orbit-lab', displayName: 'Orbit Lab' },
      { type: 'Groups', name: 'garden-unit', displayName: 'Garden Unit' },
      { type: 'Categories', name: 'science-fiction', displayName: 'SF' },
      { type: 'Tags', name: 'concept-art', displayName: 'コンセプト' },
      { type: 'Characters', name: 'luna' },
    ],
  }),
  createBook({
    groupId: 'local-library',
    bookId: 'local-003',
    url: 'https://local.nyapture.test/books/local-003',
    title: '光を集める人',
    captions: { ja: '光を集める人' },
    totalPage: 31,
    uploadedTime: '2026-08-26T11:15:00+09:00',
    status: 'Standby',
    source: 'Local',
    cover: 'amber',
    thumbnailUrl: cover03,
    tags: [
      { type: 'Artists', name: 'asanagi-studio', displayName: '朝凪スタジオ' },
      { type: 'Groups', name: 'light-collective', displayName: '光彩堂' },
      { type: 'Categories', name: 'photography', displayName: '写真' },
      { type: 'Tags', name: 'landscape', displayName: '風景' },
      { type: 'Languages', name: 'japanese', displayName: '日本語' },
    ],
  }),
  createBook({
    groupId: 'local-library',
    bookId: 'local-004',
    url: 'https://local.nyapture.test/books/local-004',
    title: '余白についてのノート',
    captions: { ja: '余白についてのノート' },
    totalPage: 56,
    uploadedTime: '2026-08-25T16:45:00+09:00',
    status: 'SaveError',
    source: 'Local',
    cover: 'mint',
    thumbnailUrl: cover04,
    tags: [
      { type: 'Artists', name: 'shiraki-ritsu', displayName: '白井リツ' },
      { type: 'Groups', name: 'margin-studio', displayName: '余白研究室' },
      { type: 'Categories', name: 'design', displayName: 'デザイン' },
      { type: 'Tags', name: 'reference', displayName: '資料' },
      { type: 'Unknown', name: 'archive-2026' },
    ],
  }),
  createBook({
    groupId: 'hitomi-la',
    bookId: 'hitomi-005',
    url: 'https://hitomi.la/doujinshi/night-train-005.html',
    title: '夜行列車スケッチ',
    captions: { ja: '夜行列車スケッチ', en: 'Night Train Sketches' },
    totalPage: 24,
    uploadedTime: '2026-08-23T20:10:00+09:00',
    status: 'WebBookInPage',
    source: 'HitomiLa',
    cover: 'rose',
    thumbnailUrl: cover05,
    tags: [
      { type: 'Artists', name: 'kitamadosha', displayName: '北窓舎' },
      { type: 'Groups', name: 'night-line', displayName: '夜線会' },
      { type: 'Categories', name: 'sketch', displayName: 'スケッチ' },
      { type: 'Tags', name: 'travel', displayName: '旅' },
      { type: 'Characters', name: 'conductor', displayName: '車掌' },
    ],
  }),
  createBook({
    groupId: 'local-library',
    bookId: 'local-006',
    url: 'https://local.nyapture.test/books/local-006',
    title: '小さな博物誌',
    captions: { ja: '小さな博物誌' },
    totalPage: 89,
    uploadedTime: '2026-08-22T08:20:00+09:00',
    status: 'ShortPage',
    source: 'Local',
    cover: 'green',
    thumbnailUrl: cover06,
    tags: [
      { type: 'Artists', name: 'mori-lab', displayName: 'Mori Lab' },
      { type: 'Groups', name: 'field-notes', displayName: 'Field Notes' },
      { type: 'Categories', name: 'nature', displayName: '自然' },
      { type: 'Tags', name: 'encyclopedia', displayName: '図鑑' },
      { type: 'Languages', name: 'bilingual', displayName: '日英併記' },
    ],
  }),
  createBook({
    groupId: 'local-library',
    bookId: 'local-007',
    url: 'https://local.nyapture.test/books/local-007',
    title: '都市と記憶の断片',
    captions: { ja: '都市と記憶の断片' },
    totalPage: 47,
    uploadedTime: '2026-08-21T13:05:00+09:00',
    status: 'Shredding',
    source: 'Local',
    cover: 'slate',
    thumbnailUrl: cover07,
    tags: [
      { type: 'Artists', name: 'misaki-yu', displayName: '三崎ユウ' },
      { type: 'Groups', name: 'city-records', displayName: '都市記録社' },
      { type: 'Categories', name: 'architecture', displayName: '建築' },
      { type: 'Tags', name: 'photography', displayName: '写真' },
      { type: 'Parodies', name: 'memory-fragments', displayName: '記憶の断片' },
    ],
  }),
  createBook({
    groupId: 'hitomi-la',
    bookId: 'hitomi-008',
    url: 'https://hitomi.la/doujinshi/chromatic-unit-008.html',
    title: '色彩標本 2026',
    captions: { ja: '色彩標本 2026', en: 'Chromatic Specimens 2026' },
    totalPage: 72,
    uploadedTime: '2026-08-20T18:40:00+09:00',
    status: 'Downloading',
    source: 'HitomiLa',
    cover: 'orange',
    thumbnailUrl: cover08,
    tags: [
      { type: 'Artists', name: 'kaleido-works', displayName: 'Kaleido Works' },
      { type: 'Groups', name: 'chromatic-unit', displayName: 'Chromatic Unit' },
      { type: 'Categories', name: 'color-design', displayName: '配色' },
      { type: 'Tags', name: 'visual-reference', displayName: 'リファレンス' },
      { type: 'Languages', name: 'english', displayName: '英語' },
    ],
  }),
  createBook({
    groupId: 'local-library',
    bookId: 'local-009',
    url: 'https://local.nyapture.test/books/local-009',
    title: '風のない日の標本',
    captions: { ja: '風のない日の標本' },
    totalPage: 37,
    uploadedTime: '2026-08-19T10:25:00+09:00',
    status: 'Cancel',
    source: 'Local',
    cover: 'rose',
    thumbnailUrl: cover09,
    tags: [
      { type: 'Artists', name: 'aozora-kikaku', displayName: '青空企画' },
      { type: 'Groups', name: 'still-air', displayName: '静風舎' },
      { type: 'Categories', name: 'mixed-media', displayName: 'ミクストメディア' },
      { type: 'Tags', name: 'windless-day', displayName: '風のない日' },
      { type: 'Languages', name: 'japanese', displayName: '日本語' },
    ],
  }),
  createBook({
    groupId: 'hitomi-la',
    bookId: 'hitomi-010',
    url: 'https://hitomi.la/doujinshi/echoes-in-glass-010.html',
    title: '硝子越しの残響',
    captions: { ja: '硝子越しの残響', en: 'Echoes Through Glass' },
    totalPage: 63,
    uploadedTime: '2026-08-18T17:50:00+09:00',
    status: 'DownloadError',
    source: 'HitomiLa',
    cover: 'blue',
    thumbnailUrl: cover10,
    tags: [
      { type: 'Artists', name: 'glass-note', displayName: '硝子ノート' },
      { type: 'Groups', name: 'echoes-studio', displayName: '残響工房' },
      { type: 'Categories', name: 'illustration', displayName: 'イラスト' },
      { type: 'Tags', name: 'afterimage', displayName: '残像' },
      { type: 'Characters', name: 'echo', displayName: 'エコー' },
      { type: 'Languages', name: 'japanese', displayName: '日本語' },
    ],
  }),
  createBook({
    groupId: 'local-library',
    bookId: 'local-011',
    url: 'https://local.nyapture.test/books/local-011',
    title: '眠りにつく灯台',
    captions: { ja: '眠りにつく灯台' },
    totalPage: 28,
    uploadedTime: '2026-08-17T07:40:00+09:00',
    status: 'Deleted',
    source: 'Local',
    cover: 'slate',
    thumbnailUrl: cover11,
    tags: [
      { type: 'Artists', name: 'harbor-moon', displayName: '港月' },
      { type: 'Groups', name: 'lighthouse-log', displayName: '灯台記録室' },
      { type: 'Categories', name: 'photography', displayName: '写真' },
      { type: 'Tags', name: 'sleeping-coast', displayName: '眠る海岸' },
      { type: 'Languages', name: 'japanese', displayName: '日本語' },
    ],
  }),
  createBook({
    groupId: 'local-library',
    bookId: 'local-012',
    url: 'https://local.nyapture.test/books/local-012',
    title: '未明のページ',
    captions: { ja: '未明のページ' },
    totalPage: 45,
    uploadedTime: '2026-08-16T21:15:00+09:00',
    status: 'Unknown',
    source: 'Local',
    cover: 'amber',
    thumbnailUrl: cover12,
    tags: [
      { type: 'Artists', name: 'dawn-index', displayName: '曙インデックス' },
      { type: 'Groups', name: 'unread-room', displayName: '未読室' },
      { type: 'Categories', name: 'design', displayName: 'デザイン' },
      { type: 'Tags', name: 'before-dawn', displayName: '夜明け前' },
      { type: 'Unknown', name: 'status-pending' },
    ],
  }),
]

export const libraryBooks = books.filter((book) => book.status !== 'WebBook' && book.status !== 'WebBookInPage')

const webSearchMatches: BookCardModel[] = [
  createBook({
    groupId: 'local-library',
    bookId: 'local-001',
    url: 'https://hitomi.la/doujinshi/rain-archive-001.html',
    title: '雨音のアーカイブ（Web検索結果）',
    captions: { ja: '雨音のアーカイブ（Web検索結果）' },
    totalPage: 40,
    uploadedTime: '2026-08-28T09:30:00+09:00',
    status: 'WebBook',
    source: 'HitomiLa',
    cover: 'blue',
    thumbnailUrl: cover01,
    tags: [
      { type: 'Artists', name: 'mizuki-ao', displayName: '水城アオ' },
      { type: 'Groups', name: 'moonlit-press', displayName: '月灯舎' },
      { type: 'Categories', name: 'illustration', displayName: 'イラスト' },
    ],
  }),
  createBook({
    groupId: 'local-library',
    bookId: 'local-004',
    url: 'https://hitomi.la/doujinshi/margin-notes-004.html',
    title: '余白についてのノート（Web検索結果）',
    captions: { ja: '余白についてのノート（Web検索結果）' },
    totalPage: 54,
    uploadedTime: '2026-08-25T16:45:00+09:00',
    status: 'WebBookInPage',
    source: 'HitomiLa',
    cover: 'mint',
    thumbnailUrl: cover04,
    tags: [
      { type: 'Artists', name: 'shiraki-ritsu', displayName: '白井リツ' },
      { type: 'Groups', name: 'margin-studio', displayName: '余白研究室' },
      { type: 'Categories', name: 'design', displayName: 'デザイン' },
    ],
  }),
  createBook({
    groupId: 'hitomi-web',
    bookId: 'hitomi-web-013',
    url: 'https://hitomi.la/doujinshi/aurora-notes-013.html',
    title: 'オーロラの余白',
    captions: { ja: 'オーロラの余白', en: 'Aurora Margins' },
    totalPage: 36,
    uploadedTime: '2026-08-15T12:10:00+09:00',
    status: 'WebBook',
    source: 'HitomiLa',
    cover: 'violet',
    thumbnailUrl: cover03,
    tags: [
      { type: 'Artists', name: 'aurora-studio', displayName: 'オーロラ工房' },
      { type: 'Groups', name: 'northern-light', displayName: '北光会' },
      { type: 'Categories', name: 'illustration', displayName: 'イラスト' },
      { type: 'Tags', name: 'soft-light', displayName: '柔らかな光' },
    ],
  }),
]

export const webSearchBooks = [
  ...books.filter((book) => book.status === 'WebBook' || book.status === 'WebBookInPage'),
  ...webSearchMatches,
]

export default books
