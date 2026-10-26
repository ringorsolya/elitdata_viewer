# ElitData ellenőrző felület

Statikus oldal (GitHub Pages, a repó gyökeréből). Adatot nem tartalmaz: minden adat a Supabase-ből jön,
és csak a `tbl_munkatarsak` listáján szereplő, bejelentkezett felhasználók olvashatják.
Minden munkatárs egyforma joggal dönthet (szabály, egyedi döntés, nyitott kérdés lezárása),
ellenőrzött adatbázis-függvényeken keresztül; minden döntés a `tbl_valtozasnaplo`-ba kerül.

A fájlban szereplő Supabase-kulcs a nyilvános (anon) kulcs, ezt böngészőben futó kódnak szánták;
a hozzáférést az adatbázis RLS-szabályai védik.
