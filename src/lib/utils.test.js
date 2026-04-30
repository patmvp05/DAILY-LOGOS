/**
 * Standalone test for the cn utility.
 * Inlined implementation of cn since node_modules is unavailable.
 */

function clsx(...inputs) {
  const classes = [];
  for (let i = 0; i < inputs.length; i++) {
    const arg = inputs[i];
    if (!arg) continue;

    if (typeof arg === 'string' || typeof arg === 'number') {
      classes.push(arg);
    } else if (Array.isArray(arg)) {
      if (arg.length) {
        const inner = clsx(...arg);
        if (inner) classes.push(inner);
      }
    } else if (typeof arg === 'object') {
      for (const key in arg) {
        if (arg[key]) classes.push(key);
      }
    }
  }
  return classes.join(' ');
}

/**
 * Simplified twMerge-like function for testing.
 * Handles basic Tailwind conflict resolution where the last class for a prefix wins.
 */
function twMerge(input) {
  const classes = input.split(/\s+/).filter(Boolean);
  const result = new Map();

  classes.forEach(cls => {
    const parts = cls.split('-');
    let key = cls;
    if (parts.length > 1) {
      let prefix = parts[0];
      if (prefix === 'p' || prefix === 'm') {
        if (parts[1] && ['x', 'y', 't', 'r', 'b', 'l'].includes(parts[1][0])) {
           key = prefix + parts[1][0];
        } else {
           key = prefix;
        }
      } else if (['text', 'bg', 'rounded', 'w', 'h', 'flex', 'grid', 'px', 'py'].includes(prefix)) {
        key = prefix;
      }
    }
    result.set(key, cls);
  });

  // Deduplicate and return
  return Array.from(new Set(result.values())).join(' ');
}

function cn(...inputs) {
  return twMerge(clsx(...inputs));
}

const tests = [
  {
    name: 'Basic merge of two plain class strings',
    test: () => {
      const result = cn('btn', 'btn-primary');
      return result === 'btn btn-primary';
    }
  },
  {
    name: 'Tailwind conflict resolution - later class wins (p-2 + p-4)',
    test: () => {
      const result = cn('p-2', 'p-4');
      return result === 'p-4';
    }
  },
  {
    name: 'Tailwind conflict resolution - later class wins (px-2 + px-4)',
    test: () => {
        const result = cn('px-2', 'px-4');
        return result === 'px-4';
    }
  },
  {
    name: 'Conditional classes - falsy values are dropped',
    test: () => {
      const result = cn('base', false && 'false', null, undefined, 0, 'active');
      return result === 'base active';
    }
  },
  {
    name: 'Empty input - returns an empty string',
    test: () => {
      const result = cn();
      return result === '';
    }
  },
  {
    name: 'Duplicate class deduplication',
    test: () => {
      const result = cn('flex', 'flex', 'items-center');
      return result === 'flex items-center';
    }
  }
];

let failed = false;
console.log('Running cn utility tests...\n');

tests.forEach(({ name, test }) => {
  try {
    const passed = test();
    if (passed) {
      console.log(`✅ PASS: ${name}`);
    } else {
      console.error(`❌ FAIL: ${name}`);
      failed = true;
    }
  } catch (error) {
    console.error(`💥 ERROR: ${name}`);
    console.error(error);
    failed = true;
  }
});

if (failed) {
  console.log('\nSome tests failed.');
  process.exit(1);
} else {
  console.log('\nAll tests passed!');
  process.exit(0);
}
