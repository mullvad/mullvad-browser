CXXFLAGS=-Icityhash -DWIN32 -DNDEBUG -D_WINDOWS -D_USRDLL -DCITYHASH_EXPORTS -DUNICODE
SRCS=CityHash.cpp cityhash/city.cpp
OBJS=$(subst .cpp,.o,$(SRCS))
LDFLAGS=-shared -Wl,--no-insert-timestamp
PLUGIN=CityHash.dll

all: $(PLUGIN)

$(PLUGIN): $(OBJS)
	$(CXX) $(OBJS) $(LDFLAGS) -o $@
	llvm-strip $@

clean:
	$(RM) $(OBJS) $(PLUGIN)
