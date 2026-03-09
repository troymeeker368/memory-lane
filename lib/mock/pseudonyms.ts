const FIRST_NAMES = [
  "Eleanor", "Mildred", "Dorothy", "Walter", "Robert", "Helen", "Ruth", "Clara", "James", "Thomas", "Margaret", "Edith",
  "Frank", "Bernice", "Louis", "Harold", "Shirley", "Betty", "Louise", "Vivian", "Arthur", "Norma", "Janet", "Marion",
  "Irene", "Phyllis", "Paul", "Raymond", "Lillian", "Joan", "Frances", "Doris", "George", "Patricia", "Caroline", "Beatrice",
  "Allan", "Eugene", "Gerald", "Martha", "Carol", "Judith", "Constance", "Florence", "Gloria", "Anita", "Theresa", "Wanda",
  "Nancy", "Elaine", "Sharon", "Joanne", "Cynthia", "Ralph", "Stanley", "Howard", "Neil", "Victor", "Angela", "Renee",
  "Terry", "Debra", "Monica", "Sandra", "Valerie", "Brenda", "Denise", "Alfred", "Gertrude", "Naomi", "Dianne", "Maxine"
] as const;

const LAST_NAMES = [
  "Hayes", "Ellis", "Foster", "Bennett", "Reynolds", "Whitaker", "Sullivan", "Merritt", "Porter", "Donovan", "Griffin", "Holland",
  "Caldwell", "Manning", "Bishop", "Delaney", "Bradford", "Harmon", "Morris", "Keller", "Hampton", "Maddox", "Pruitt", "Brennan",
  "Coleman", "Barrett", "Kendall", "Hensley", "Mayo", "Chapman", "Stafford", "Nolan", "Barton", "Barnes", "Gilmore", "Payne",
  "Hawkins", "Bauer", "Cross", "Sanders", "Norris", "Hoffman", "Mercer", "Gibson", "Weaver", "McLean", "Stewart", "Burke",
  "Meadows", "Shepard", "Tucker", "Turner", "Lowry", "Preston", "Carver", "Callahan", "Duncan", "Morrison", "Reed", "Sparks",
  "Austin", "Baldwin", "Parker", "Brooks", "Miles", "Walsh", "Drake", "Larson", "Conley", "Gaines", "Vance", "Phelps"
] as const;

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createUniqueNameFromSeed(seed: number, used: Set<string>) {
  let attempt = 0;
  while (attempt < FIRST_NAMES.length * LAST_NAMES.length) {
    const first = FIRST_NAMES[(seed + attempt * 7) % FIRST_NAMES.length];
    const last = LAST_NAMES[(Math.floor(seed / 17) + attempt * 11) % LAST_NAMES.length];
    const candidate = `${first} ${last}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    attempt += 1;
  }

  const fallback = `Member ${seed % 100000}`;
  used.add(fallback);
  return fallback;
}

export function createStablePseudonymMap(keys: string[], salt = "member") {
  const map = new Map<string, string>();
  const used = new Set<string>();

  const orderedKeys = [...keys].sort((a, b) => a.localeCompare(b));
  for (const key of orderedKeys) {
    const seed = hashString(`${salt}:${key}`);
    map.set(key, createUniqueNameFromSeed(seed, used));
  }

  return map;
}

export function createStablePseudonym(key: string, salt = "member") {
  const map = createStablePseudonymMap([key], salt);
  return map.get(key) ?? "Member 0000";
}
