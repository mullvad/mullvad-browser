// |jit-test| module

function a() {
  let x = 1;
  return 0<!--x
}
assertEq(isLazyFunction(a), true);
assertEq(a(), true);

var s;
var b = function() {
  s = 0 <!-- s, `
  function hidden() {}
  s = 1 <!-- s `;
};
assertEq(isLazyFunction(b), true);
b();
assertEq(s, true);

var c = eval("function cc() { let x = 1; return 0<!--x\n} cc");
assertEq(isLazyFunction(c), true);
assertEq(c(), 0);

var d = eval([
  'var d = function() {',
  '  var r;',
  '  r = 0 <!-- r, `',
  '  function hidden() {}',
  '  r = 1 <!-- r `;',
  '  return r;',
  '};',
  'd'
].join('\n'));
assertEq(isLazyFunction(d), true);
assertEq(d(), 1);
