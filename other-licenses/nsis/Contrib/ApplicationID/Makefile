CXXFLAGS=-Icityhash -DWIN32 -DNDEBUG -D_WINDOWS -D_USRDLL -DCITYHASH_EXPORTS -DUNICODE
SRCS=Set.cpp
OBJS=$(subst .cpp,.o,$(SRCS))
LDFLAGS=-lole32 -lshlwapi -shared -Wl,--no-insert-timestamp
PLUGIN=ApplicationID.dll

all: $(PLUGIN)

$(PLUGIN): $(OBJS)
	$(CXX) $(OBJS) $(LDFLAGS) -o $@
	llvm-strip $@

clean:
	$(RM) $(OBJS) $(PLUGIN)
