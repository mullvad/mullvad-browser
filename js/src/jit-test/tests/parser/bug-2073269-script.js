function a() {
  let x = 1;
  return 0<!--x
}
assertEq(isLazyFunction(a), true);
assertEq(a(), 0);

var s;
var b = function() {
  s = 0 <!-- s, `
  function hidden() {}
  s = 1 <!-- s `;
};
assertEq(isLazyFunction(b), true);
b();
assertEq(s, 1);
