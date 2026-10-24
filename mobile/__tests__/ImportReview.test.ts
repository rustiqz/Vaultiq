import { draftToItem } from '../src/ImportReview';

// Test-only values: nothing here is a real credential.
const empty = { name: '', username: '', password: '', url: '', notes: '' };

describe('draftToItem', () => {
  it('refuses a login with neither username nor password', () => {
    expect(draftToItem('login', { ...empty, name: 'Only a name' })).toBeNull();
  });

  it('builds a login from whatever was filled in, omitting blanks', () => {
    expect(draftToItem('login', { ...empty, name: ' Site ', username: 'alex', url: ' https://a.example.test ' })).toEqual({
      type: 'login',
      name: 'Site',
      username: 'alex',
      url: 'https://a.example.test',
    });
  });

  it('refuses an empty note and builds one from a name or text', () => {
    expect(draftToItem('note', empty)).toBeNull();
    expect(draftToItem('note', { ...empty, notes: 'fixture text' })).toEqual({ type: 'note', notes: 'fixture text' });
  });
});
