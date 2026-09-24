function assign(mode) {
  if (mode) {
    newBinding = mode === 1 ? confuse() : "value for global lexical";
  }
}
function confuse() {
  evaluate("let newBinding;");
  for (let i = 0; i < 3; i++) {
    assign(2);
  }
  return "valueForGlobalThis";
}
for (let i = 0; i < 50; i++) {
  assign(0);
}
assign(1);
assertEq(globalThis["newBinding"], "valueForGlobalThis");
assertEq(newBinding, "value for global lexical");
