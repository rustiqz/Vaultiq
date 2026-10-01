import {contentWithType} from './itemType';

describe('contentWithType', () => {
  it('adds the header type while preserving unrelated fields', () => {
    expect(contentWithType('login', {username: 'fake-user', nested: {value: 1}})).toEqual({
      username: 'fake-user',
      nested: {value: 1},
      type: 'login',
    });
  });

  it('uses the header when the payload type disagrees', () => {
    expect(contentWithType('login', {type: 'note', username: 'fake-user'})).toEqual({
      type: 'login',
      username: 'fake-user',
    });
  });

  it('does not mutate a frozen input', () => {
    const content = Object.freeze({username: 'fake-user'});
    expect(contentWithType('login', content)).toEqual({username: 'fake-user', type: 'login'});
    expect(content).toEqual({username: 'fake-user'});
  });

  it('handles an empty usage record', () => {
    expect(contentWithType('usage', {})).toEqual({type: 'usage'});
  });
});
